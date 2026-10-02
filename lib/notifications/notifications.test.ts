import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/security/crypto is server-only and reads the validated env at import
// time; tests neutralise both so the REAL maskPhone implementation runs.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/env", () => ({
  env: {
    SMS_PROVIDER: "mock",
    EMAIL_PROVIDER: "mock",
    INVOICING_PROVIDER: "mock",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    QR_TOKEN_SECRET: "unit-test-secret-unit-test-secret!!!",
  },
}));

import {
  buildRefundMessage,
  formatEuros,
  getEmailProvider,
  getSmsProvider,
  notifyGuestRefund,
} from "@/lib/notifications";
import {
  clearNotificationOutboxes,
  emailOutbox,
  MockEmailProvider,
  MockSmsProvider,
  smsOutbox,
} from "@/lib/notifications/mock";

const PHONE = "+351912345678";
const MASKED = "+3519******78"; // maskPhone keeps "+3519" and the last 2 digits

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearNotificationOutboxes();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatEuros", () => {
  it("drops decimals on whole-euro amounts", () => {
    expect(formatEuros(1100)).toBe("11 €");
  });

  it("formats cents with a pt-PT decimal comma", () => {
    expect(formatEuros(1250)).toBe("12,50 €");
  });

  it("formats zero", () => {
    expect(formatEuros(0)).toBe("0 €");
  });

  it("pads sub-euro amounts to two decimals", () => {
    expect(formatEuros(5)).toBe("0,05 €");
    expect(formatEuros(90)).toBe("0,90 €");
  });

  it("groups thousands pt-PT style", () => {
    expect(formatEuros(123456)).toBe("1.234,56 €");
    expect(formatEuros(100000000)).toBe("1.000.000 €");
  });

  it("keeps the sign on negative amounts", () => {
    expect(formatEuros(-350)).toBe("-3,50 €");
  });

  it("rejects non-integer cents", () => {
    expect(() => formatEuros(12.5)).toThrow(RangeError);
    expect(() => formatEuros(Number.NaN)).toThrow(RangeError);
  });
});

describe("buildRefundMessage", () => {
  it("builds the exact pt-PT notice", () => {
    expect(
      buildRefundMessage({
        amountCents: 1250,
        trackTitle: "Balada do Mar",
        reason: "rejected_by_dj",
      }),
    ).toBe(
      "BetBeat: devolvemos 12,50 € do teu pedido «Balada do Mar». " +
        "Motivo: o DJ não aceitou o pedido.",
    );
  });

  it("covers the partial-refund (tier demotion) wording", () => {
    expect(
      buildRefundMessage({
        amountCents: 400,
        trackTitle: "Noite Azul",
        reason: "tier_demoted",
      }),
    ).toBe(
      "BetBeat: devolvemos 4 € do teu pedido «Noite Azul». " +
        "Motivo: a música não tocou no prazo prometido.",
    );
  });
});

describe("MockSmsProvider", () => {
  it("records the message in the outbox and returns ok + ref", async () => {
    const result = await new MockSmsProvider().send(PHONE, "olá");
    expect(result.ok).toBe(true);
    expect(result.ref).toMatch(/^mock_sms_/);
    expect(smsOutbox).toHaveLength(1);
    expect(smsOutbox[0]).toMatchObject({
      kind: "sms",
      to: PHONE,
      body: "olá",
      ref: result.ref,
    });
  });

  it("logs only the MASKED phone number", async () => {
    await new MockSmsProvider().send(PHONE, "olá");
    const logged = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(MASKED);
    expect(logged).not.toContain("912345678");
  });

  it("rejects a non-E.164 recipient without recording it", async () => {
    const result = await new MockSmsProvider().send("912345678", "olá");
    expect(result).toEqual({ ok: false });
    expect(smsOutbox).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("MockEmailProvider", () => {
  it("records subject and body in the outbox and returns ok + ref", async () => {
    const result = await new MockEmailProvider().send(
      "convidado@example.com",
      "Assunto",
      "Corpo",
    );
    expect(result.ok).toBe(true);
    expect(result.ref).toMatch(/^mock_email_/);
    expect(emailOutbox).toHaveLength(1);
    expect(emailOutbox[0]).toMatchObject({
      kind: "email",
      to: "convidado@example.com",
      subject: "Assunto",
      body: "Corpo",
      ref: result.ref,
    });
  });

  it("rejects a malformed address without recording it", async () => {
    const result = await new MockEmailProvider().send("não-é-email", "a", "b");
    expect(result).toEqual({ ok: false });
    expect(emailOutbox).toHaveLength(0);
  });
});

describe("provider factories", () => {
  it("return mock singletons (lazy env import)", async () => {
    const sms = await getSmsProvider();
    expect(sms).toBeInstanceOf(MockSmsProvider);
    expect(await getSmsProvider()).toBe(sms);

    const email = await getEmailProvider();
    expect(email).toBeInstanceOf(MockEmailProvider);
    expect(await getEmailProvider()).toBe(email);
  });
});

describe("notifyGuestRefund", () => {
  const base = {
    amountCents: 1250,
    trackTitle: "Balada do Mar",
    reason: "dj_timeout",
  } as const;

  it("prefers SMS when the guest gave a phone", async () => {
    const result = await notifyGuestRefund({ ...base, phoneE164: PHONE });
    expect(result.message).toBe(
      "BetBeat: devolvemos 12,50 € do teu pedido «Balada do Mar». " +
        "Motivo: o pedido expirou sem resposta do DJ.",
    );
    expect(result.sms?.ok).toBe(true);
    expect(result.email).toBeUndefined();
    expect(smsOutbox).toHaveLength(1);
    expect(smsOutbox[0]?.body).toBe(result.message);
    expect(emailOutbox).toHaveLength(0);
  });

  it("does not double-send when the guest gave both contacts", async () => {
    await notifyGuestRefund({
      ...base,
      phoneE164: PHONE,
      email: "convidado@example.com",
    });
    expect(smsOutbox).toHaveLength(1);
    expect(emailOutbox).toHaveLength(0);
  });

  it("uses email when there is no phone", async () => {
    const result = await notifyGuestRefund({
      ...base,
      email: "convidado@example.com",
    });
    expect(result.sms).toBeUndefined();
    expect(result.email?.ok).toBe(true);
    expect(emailOutbox).toHaveLength(1);
    expect(emailOutbox[0]?.subject).toBe("BetBeat — reembolso do teu pedido");
    expect(emailOutbox[0]?.body).toBe(result.message);
  });

  it("falls back to email when the SMS send fails", async () => {
    const result = await notifyGuestRefund({
      ...base,
      phoneE164: "nope",
      email: "convidado@example.com",
    });
    expect(result.sms?.ok).toBe(false);
    expect(result.email?.ok).toBe(true);
    expect(smsOutbox).toHaveLength(0);
    expect(emailOutbox).toHaveLength(1);
  });

  it("returns only the message when the guest gave no contacts", async () => {
    const result = await notifyGuestRefund(base);
    expect(result.sms).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(smsOutbox).toHaveLength(0);
    expect(emailOutbox).toHaveLength(0);
  });
});
