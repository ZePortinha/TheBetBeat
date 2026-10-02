/**
 * MockPaymentProvider + signed webhooks (BRIEF B4.3, B4.4).
 * Pure unit tests: fixed injected clock, no env, no I/O.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  MBWAY_DEFAULT_TIMEOUT_MS,
  MOCK_MBWAY_FAIL_PHONE,
  MOCK_MBWAY_NEVER_CONFIRM_PHONE,
  MockPaymentProvider,
} from "./mock";
import { buildMockWebhook, signWebhookBody, verifySignedWebhook } from "./webhooks";
import type { AuthorizeInput, WebhookEvent } from "./types";

const SECRET = "test_webhook_secret_0123456789";
const T0 = Date.UTC(2026, 0, 1, 23, 0, 0); // a fixed club night

let nowMs: number;
let psp: MockPaymentProvider;

function cardInput(overrides: Partial<AuthorizeInput> = {}): AuthorizeInput {
  return {
    idempotencyKey: `key_${Math.random().toString(36).slice(2)}`,
    requestId: "req_1",
    method: "card",
    amountCents: 500,
    currency: "EUR",
    ...overrides,
  };
}

function mbwayInput(overrides: Partial<AuthorizeInput> = {}): AuthorizeInput {
  return {
    idempotencyKey: `key_${Math.random().toString(36).slice(2)}`,
    requestId: "req_1",
    method: "mbway",
    amountCents: 500,
    currency: "EUR",
    phone: "+351910000000",
    ...overrides,
  };
}

beforeEach(() => {
  nowMs = T0;
  psp = new MockPaymentProvider({ webhookSecret: SECRET, now: () => nowMs });
});

describe("authorize (card & wallets)", () => {
  it("returns 'authorized' immediately for card, apple_pay and google_pay", async () => {
    for (const method of ["card", "apple_pay", "google_pay"] as const) {
      const res = await psp.authorize(cardInput({ method }));
      expect(res.status).toBe("authorized");
      expect(res.providerRef).toMatch(/^mock_auth_/);
      expect(res.clientAction).toEqual({ kind: "none" });
    }
  });

  it("rejects mbway through authorize()", async () => {
    await expect(psp.authorize(mbwayInput())).rejects.toThrow(/charge\(\)/);
  });

  it("is idempotent: a repeated key returns the memoized result object", async () => {
    const input = cardInput({ idempotencyKey: "auth_once" });
    const first = await psp.authorize(input);
    const second = await psp.authorize(input);
    expect(second).toBe(first); // same object, not just equal
  });
});

describe("charge (MB WAY)", () => {
  it("returns 'pending' with expiresAt = now + 4 min by default", async () => {
    const res = await psp.charge(mbwayInput());
    expect(res.status).toBe("pending");
    expect(res.providerRef).toMatch(/^mock_mbway_/);
    expect(res.expiresAt).toBe(
      new Date(T0 + MBWAY_DEFAULT_TIMEOUT_MS).toISOString(),
    );
  });

  it("honors a configured timeout", async () => {
    const custom = new MockPaymentProvider({
      webhookSecret: SECRET,
      now: () => nowMs,
      mbwayTimeoutMs: 60_000,
    });
    const res = await custom.charge(mbwayInput());
    expect(res.expiresAt).toBe(new Date(T0 + 60_000).toISOString());
  });

  it("rejects card methods and missing phone", async () => {
    await expect(psp.charge(cardInput())).rejects.toThrow(/authorize\(\)/);
    await expect(
      psp.charge(mbwayInput({ phone: undefined })),
    ).rejects.toThrow(/phone/);
  });

  it(`fails immediately for ${MOCK_MBWAY_FAIL_PHONE}`, async () => {
    const res = await psp.charge(mbwayInput({ phone: MOCK_MBWAY_FAIL_PHONE }));
    expect(res.status).toBe("failed");
    const status = await psp.getStatus(res.providerRef);
    expect(status.status).toBe("failed");
  });

  it(`${MOCK_MBWAY_NEVER_CONFIRM_PHONE} stays pending, refuses confirmation and expires`, async () => {
    const res = await psp.charge(
      mbwayInput({ phone: MOCK_MBWAY_NEVER_CONFIRM_PHONE }),
    );
    expect(res.status).toBe("pending");
    expect(() => psp.simulateMbwayConfirmation(res.providerRef)).toThrow(
      /never confirms/,
    );
    expect((await psp.getStatus(res.providerRef)).status).toBe("pending");

    nowMs = T0 + MBWAY_DEFAULT_TIMEOUT_MS; // deadline reached
    expect((await psp.getStatus(res.providerRef)).status).toBe("expired");
  });

  it("is idempotent: a repeated key returns the same pending intent", async () => {
    const input = mbwayInput({ idempotencyKey: "charge_once" });
    const first = await psp.charge(input);
    const second = await psp.charge(input);
    expect(second).toBe(first);
  });
});

describe("capture", () => {
  it("captures up to the authorized amount, partially or in full", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 1000 }));
    const res = await psp.capture(auth.providerRef, 600, "cap_partial");
    expect(res.status).toBe("captured");
    expect((await psp.getStatus(auth.providerRef)).status).toBe("captured");
  });

  it("rejects a capture above the authorized amount", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 500 }));
    await expect(
      psp.capture(auth.providerRef, 501, "cap_over"),
    ).rejects.toThrow(/exceeds authorized/);
  });

  it("is idempotent: same key twice is a single logical capture", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 1000 }));
    const first = await psp.capture(auth.providerRef, 1000, "cap_once");
    const second = await psp.capture(auth.providerRef, 1000, "cap_once");
    expect(second).toBe(first);
    // Only one capture happened: the full amount is refundable exactly once.
    await psp.refund(auth.providerRef, 1000, "rf_all");
    await expect(
      psp.refund(auth.providerRef, 1, "rf_extra"),
    ).rejects.toThrow(/exceeds refundable/);
  });

  it("amount ending in 99 fails once (transient), then the retry succeeds", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 1099 }));
    await expect(
      psp.capture(auth.providerRef, 1099, "cap_retry"),
    ).rejects.toThrow(/transient/);
    // Same idempotency key on retry — the transient error was NOT memoized.
    const retry = await psp.capture(auth.providerRef, 1099, "cap_retry");
    expect(retry.status).toBe("captured");
  });

  it("rejects capture of an unknown providerRef", async () => {
    await expect(psp.capture("mock_auth_nope", 100, "k")).rejects.toThrow(
      /unknown providerRef/,
    );
  });
});

describe("void", () => {
  it("voids an authorization that will not be captured", async () => {
    const auth = await psp.authorize(cardInput());
    const res = await psp.void(auth.providerRef, "void_1");
    expect(res.status).toBe("voided");
    expect((await psp.getStatus(auth.providerRef)).status).toBe("voided");
  });

  it("is idempotent and blocks capture after void", async () => {
    const auth = await psp.authorize(cardInput());
    const first = await psp.void(auth.providerRef, "void_once");
    expect(await psp.void(auth.providerRef, "void_once")).toBe(first);
    await expect(
      psp.capture(auth.providerRef, 100, "cap_after_void"),
    ).rejects.toThrow(/status 'voided'/);
  });
});

describe("refund", () => {
  it("resolves on success with a refund reference", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 800 }));
    await psp.capture(auth.providerRef, 800, "cap_1");
    const res = await psp.refund(auth.providerRef, 300, "rf_1");
    expect(res.providerRef).toMatch(/^mock_rf_/);
  });

  it("is idempotent: same key twice is a single logical refund", async () => {
    const auth = await psp.authorize(cardInput({ amountCents: 800 }));
    await psp.capture(auth.providerRef, 800, "cap_1");
    const first = await psp.refund(auth.providerRef, 500, "rf_once");
    const second = await psp.refund(auth.providerRef, 500, "rf_once");
    expect(second).toBe(first);
    // Only 500 was refunded, so the remaining 300 is still refundable…
    await psp.refund(auth.providerRef, 300, "rf_rest");
    // …and nothing more.
    await expect(
      psp.refund(auth.providerRef, 1, "rf_more"),
    ).rejects.toThrow(/exceeds refundable/);
  });

  it("rejects refunds with nothing captured", async () => {
    const auth = await psp.authorize(cardInput());
    await expect(
      psp.refund(auth.providerRef, 100, "rf_nothing"),
    ).rejects.toThrow(/nothing captured/);
  });

  it("refunds a confirmed MB WAY charge in full", async () => {
    const charge = await psp.charge(mbwayInput({ amountCents: 700 }));
    psp.simulateMbwayConfirmation(charge.providerRef);
    const res = await psp.refund(charge.providerRef, 700, "rf_mbway");
    expect(res.providerRef).toMatch(/^mock_rf_/);
  });
});

describe("signed webhooks", () => {
  async function confirmedWebhook(): Promise<{
    event: WebhookEvent;
    rawBody: string;
    signature: string;
  }> {
    const charge = await psp.charge(mbwayInput());
    const event = psp.simulateMbwayConfirmation(charge.providerRef);
    return { event, ...psp.buildWebhook(event) };
  }

  it("verifies a correctly signed event (strict allowlist parse)", async () => {
    const { event, rawBody, signature } = await confirmedWebhook();
    const verified = await psp.verifyWebhook(rawBody, signature);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(event.id);
    expect(verified?.providerRef).toBe(event.providerRef);
    expect(verified?.type).toBe("payment.confirmed");
    expect(verified?.amountCents).toBe(500);
  });

  it("duplicate deliveries of the same event verify identically (same id)", async () => {
    const { event, rawBody, signature } = await confirmedWebhook();
    const a = await psp.verifyWebhook(rawBody, signature);
    const b = await psp.verifyWebhook(rawBody, signature);
    expect(a?.id).toBe(b?.id);
    // Rebuilding the same event signs identically — a true duplicate.
    const rebuilt = buildMockWebhook(event, SECRET);
    expect(rebuilt.rawBody).toBe(rawBody);
    expect(rebuilt.signature).toBe(signature);
  });

  it("returns null for a tampered signature", async () => {
    const { rawBody, signature } = await confirmedWebhook();
    const flipped =
      (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    expect(await psp.verifyWebhook(rawBody, flipped)).toBeNull();
    expect(await psp.verifyWebhook(rawBody, "not-hex")).toBeNull();
    expect(await psp.verifyWebhook(rawBody, "")).toBeNull();
  });

  it("returns null for a tampered body", async () => {
    const { rawBody, signature } = await confirmedWebhook();
    const tampered = rawBody.replace('"amountCents":500', '"amountCents":1');
    expect(tampered).not.toBe(rawBody);
    expect(await psp.verifyWebhook(tampered, signature)).toBeNull();
  });

  it("returns null for valid signatures over invalid payloads (allowlist)", async () => {
    const extra = JSON.stringify({
      id: "evt_x",
      providerRef: "mock_mbway_x",
      type: "payment.confirmed",
      raw: null,
      injected: "field", // not allowlisted
    });
    expect(
      await psp.verifyWebhook(extra, signWebhookBody(extra, SECRET)),
    ).toBeNull();

    const badType = JSON.stringify({
      id: "evt_x",
      providerRef: "mock_mbway_x",
      type: "payment.hacked",
      raw: null,
    });
    expect(
      await psp.verifyWebhook(badType, signWebhookBody(badType, SECRET)),
    ).toBeNull();

    const notJson = "this is not json";
    expect(
      await psp.verifyWebhook(notJson, signWebhookBody(notJson, SECRET)),
    ).toBeNull();
  });

  it("verifySignedWebhook is usable standalone with the shared secret", async () => {
    const { rawBody, signature } = await confirmedWebhook();
    expect(verifySignedWebhook(rawBody, signature, SECRET)).not.toBeNull();
    expect(verifySignedWebhook(rawBody, signature, "wrong_secret_000000")).toBeNull();
  });
});

describe("simulation events", () => {
  it("decline and expiry produce the matching webhook events", async () => {
    const declined = await psp.charge(mbwayInput());
    const declineEvt = psp.simulateMbwayDecline(declined.providerRef);
    expect(declineEvt.type).toBe("payment.failed");
    expect((await psp.getStatus(declined.providerRef)).status).toBe("failed");

    const expired = await psp.charge(mbwayInput());
    const expiryEvt = psp.simulateMbwayExpiry(expired.providerRef);
    expect(expiryEvt.type).toBe("payment.expired");
    expect((await psp.getStatus(expired.providerRef)).status).toBe("expired");
  });

  it("getStatus rejects unknown providerRefs", async () => {
    await expect(psp.getStatus("mock_mbway_ghost")).rejects.toThrow(
      /unknown providerRef/,
    );
  });
});
