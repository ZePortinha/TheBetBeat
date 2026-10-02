import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { PaymentIntentResult, PaymentProvider } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/env", () => ({
  env: {
    DATABASE_URL: "postgresql://unit:test@localhost:5432/unused",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "unit-test-key",
  },
}));

const {
  capturePayment,
  ensureRefund,
  parsePaymentPurpose,
  voidAuthorization,
  webhookActionForPayment,
} = await import("./service");

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

interface Route {
  match: string;
  rows?: unknown[];
}

/** Scripted PoolClient: routes each query by SQL substring, records all. */
function fakeClient(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    const route = routes.find((r) => sql.includes(r.match));
    const rows = route?.rows ?? [];
    return { rows, rowCount: rows.length };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

function fakeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const result: PaymentIntentResult = { providerRef: "mock_rf_1", status: "captured" };
  return {
    name: "fake",
    authorize: vi.fn(async () => result),
    capture: vi.fn(async () => result),
    void: vi.fn(async () => ({ providerRef: "ref", status: "voided" as const })),
    charge: vi.fn(async () => result),
    refund: vi.fn(async () => result),
    getStatus: vi.fn(async () => result),
    verifyWebhook: vi.fn(async () => null),
    ...overrides,
  };
}

const META = { requestId: "req-1", sessionId: "sess-1", venueId: "venue-1" };
const NOW = 1_700_000_000_000;

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-row-1",
    request_id: "req-1",
    guest_id: "guest-1",
    provider: "mock",
    method: "mbway",
    status: "captured",
    amount_cents: 2500,
    captured_cents: 2500,
    provider_ref: "mock_mbway_1",
    idempotency_key: "pay:req-1",
    expires_at: null,
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("parsePaymentPurpose", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  it("recognizes primary and upgrade keys", () => {
    expect(parsePaymentPurpose(`pay:${id}`)).toEqual({ kind: "primary", requestId: id });
    expect(parsePaymentPurpose(`pay:${id}:upgrade:NEXT`)).toEqual({
      kind: "upgrade",
      requestId: id,
      toTier: "NEXT",
    });
  });

  it("rejects malformed keys", () => {
    expect(parsePaymentPurpose("refund:x:y").kind).toBe("unknown");
    expect(parsePaymentPurpose(`pay:${id}:upgrade:VIP`).kind).toBe("unknown");
    expect(parsePaymentPurpose("pay:not-a-uuid").kind).toBe("unknown");
  });
});

describe("webhookActionForPayment (duplicate-webhook guards)", () => {
  it("confirms a pending MB WAY charge exactly once", () => {
    expect(
      webhookActionForPayment({ status: "pending", method: "mbway" }, "payment.confirmed"),
    ).toBe("confirm_mbway");
    // A captured payment ignores repeat confirmations (B4.3 Robustez).
    expect(
      webhookActionForPayment({ status: "captured", method: "mbway" }, "payment.confirmed"),
    ).toBe("ignore");
  });

  it("confirms a pending card/wallet as an authorization", () => {
    expect(
      webhookActionForPayment({ status: "pending", method: "card" }, "payment.confirmed"),
    ).toBe("confirm_authorization");
    expect(
      webhookActionForPayment({ status: "authorized", method: "card" }, "payment.confirmed"),
    ).toBe("ignore");
  });

  it("fails/expires only from live statuses", () => {
    expect(
      webhookActionForPayment({ status: "pending", method: "mbway" }, "payment.failed"),
    ).toBe("fail");
    expect(
      webhookActionForPayment({ status: "failed", method: "mbway" }, "payment.failed"),
    ).toBe("ignore");
    expect(
      webhookActionForPayment({ status: "pending", method: "mbway" }, "payment.expired"),
    ).toBe("expire");
    expect(
      webhookActionForPayment({ status: "captured", method: "mbway" }, "payment.expired"),
    ).toBe("ignore");
  });
});

/* ------------------------------------------------------------------ */
/* ensureRefund                                                        */
/* ------------------------------------------------------------------ */

describe("ensureRefund", () => {
  it("inserts the refund, calls the provider once and posts the ledger group", async () => {
    const provider = fakeProvider();
    const { client, calls } = fakeClient([
      { match: "from public.payments", rows: [paymentRow()] },
      { match: "from public.refunds", rows: [] },
      { match: "insert into public.refunds", rows: [{ id: "rf-1" }] },
    ]);

    const outcome = await ensureRefund(client, META, 2500, "rejected_by_dj", NOW, {
      provider,
    });

    expect(outcome).toEqual({ executed: true, status: "succeeded", refundedCents: 2500 });
    expect(provider.refund).toHaveBeenCalledTimes(1);
    expect(provider.refund).toHaveBeenCalledWith(
      "mock_mbway_1",
      2500,
      "refund:req-1:rejected_by_dj",
    );
    const insert = calls.find((c) => c.sql.includes("insert into public.refunds"));
    expect(insert?.params).toContain("refund:req-1:rejected_by_dj");
    expect(calls.some((c) => c.sql.includes("insert into public.ledger_entries"))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql.includes("status = 'succeeded'"))).toBe(true);
  });

  it("is a no-op when the (request, reason) key already exists", async () => {
    const provider = fakeProvider();
    const { client, calls } = fakeClient([
      { match: "from public.payments", rows: [paymentRow()] },
      { match: "from public.refunds", rows: [] },
      { match: "insert into public.refunds", rows: [] }, // conflict → no row
    ]);

    const outcome = await ensureRefund(client, META, 2500, "rejected_by_dj", NOW, {
      provider,
    });

    expect(outcome).toEqual({ executed: false, status: "duplicate", refundedCents: 0 });
    expect(provider.refund).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes("insert into public.ledger_entries"))).toBe(
      false,
    );
  });

  it("marks the row failed WITHOUT throwing when the provider errors", async () => {
    const provider = fakeProvider({
      refund: vi.fn(async () => {
        throw new Error("psp down");
      }),
    });
    const { client, calls } = fakeClient([
      { match: "from public.payments", rows: [paymentRow()] },
      { match: "from public.refunds", rows: [] },
      { match: "insert into public.refunds", rows: [{ id: "rf-1" }] },
    ]);

    const outcome = await ensureRefund(client, META, 2500, "dj_timeout", NOW, {
      provider,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.refundedCents).toBe(0);
    expect(calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(true);
    // No ledger movement for money that did not move.
    expect(calls.some((c) => c.sql.includes("insert into public.ledger_entries"))).toBe(
      false,
    );
  });

  it("reports nothing_captured for authorization-only payments", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient([
      {
        match: "from public.payments",
        rows: [paymentRow({ status: "authorized", captured_cents: 0 })],
      },
      { match: "from public.refunds", rows: [] },
    ]);

    const outcome = await ensureRefund(client, META, 2500, "session_ended", NOW, {
      provider,
    });

    expect(outcome.status).toBe("nothing_captured");
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it("never refunds more than the refundable remainder", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient([
      { match: "where idempotency_key", rows: [] }, // not a duplicate
      { match: "from public.payments", rows: [paymentRow()] },
      // 1 400 of the 2 500 already committed to an earlier refund.
      { match: "from public.refunds", rows: [{ payment_id: "pay-row-1", total: "1400" }] },
      { match: "insert into public.refunds", rows: [{ id: "rf-2" }] },
    ]);

    const outcome = await ensureRefund(client, META, 2500, "session_ended", NOW, {
      provider,
    });

    expect(provider.refund).toHaveBeenCalledWith(
      "mock_mbway_1",
      1100,
      "refund:req-1:session_ended",
    );
    expect(outcome.refundedCents).toBe(1100);
  });
});

/* ------------------------------------------------------------------ */
/* capturePayment / voidAuthorization                                  */
/* ------------------------------------------------------------------ */

describe("capturePayment", () => {
  it("is a no-op for an MB WAY charge captured at confirmation", async () => {
    const provider = fakeProvider();
    const { client, calls } = fakeClient([
      { match: "from public.payments", rows: [paymentRow()] },
    ]);

    const outcome = await capturePayment(client, META, 2500, NOW, { provider });

    expect(outcome).toEqual({ capturedCents: 0, alreadySettled: true });
    expect(provider.capture).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes("ledger_entries"))).toBe(false);
  });

  it("captures an authorized card up to the target and posts the ledger", async () => {
    const provider = fakeProvider();
    const { client, calls } = fakeClient([
      {
        match: "from public.payments",
        rows: [
          paymentRow({
            method: "card",
            status: "authorized",
            captured_cents: 0,
            amount_cents: 3000,
            provider_ref: "mock_auth_1",
          }),
        ],
      },
    ]);

    // Target 1 100 < authorized 3 000: SLA demotion shrank the capture.
    const outcome = await capturePayment(client, META, 1100, NOW, { provider });

    expect(outcome.capturedCents).toBe(1100);
    expect(provider.capture).toHaveBeenCalledWith("mock_auth_1", 1100, "capture:pay-row-1");
    expect(calls.some((c) => c.sql.includes("insert into public.ledger_entries"))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql.includes("status = 'captured'"))).toBe(true);
  });
});

describe("voidAuthorization", () => {
  it("voids only authorized payments", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient([
      {
        match: "from public.payments",
        rows: [
          paymentRow({
            method: "card",
            status: "authorized",
            captured_cents: 0,
            provider_ref: "mock_auth_1",
          }),
          paymentRow({ id: "pay-row-2", status: "captured" }),
        ],
      },
    ]);

    const outcome = await voidAuthorization(client, META, { provider });

    expect(outcome.voidedCents).toBe(2500);
    expect(provider.void).toHaveBeenCalledTimes(1);
    expect(provider.void).toHaveBeenCalledWith("mock_auth_1", "void:pay-row-1");
  });
});
