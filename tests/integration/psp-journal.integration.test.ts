/**
 * Integration tests for the ifthenpay PSP journal (migration 0013) on the
 * real Postgres:
 *
 *   SUPABASE_TEST=1 pnpm exec vitest run tests/integration/psp-journal.integration.test.ts
 *
 *  - a refund key is sent once across "processes" (two provider instances);
 *  - two concurrent refunds of one payment never exceed what was paid;
 *  - a timed-out push the guest approved anyway (orphan) is refunded in full
 *    by the worker, exactly once, with an audit trail.
 *
 * ifthenpay itself is faked at the HTTP layer; everything else is real.
 */
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "local-anon-key-placeholder";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "local-service-key-placeholder";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.QR_TOKEN_SECRET ??= "integration-test-qr-secret-0123456789abcdef";
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??= "test-site-key";
process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
process.env.PAYMENT_WEBHOOK_SECRET ??= "integration-webhook-secret";

const { IfthenpayProvider, orderIdFor } = await import("@/lib/payments/ifthenpay");
const { pgJournal } = await import("@/lib/payments/journal-pg");
const { PaymentOutcomeUnknownError } = await import("@/lib/payments/journal");
const db = await import("@/lib/db");

/** Fake ifthenpay: answers in order; counts refund calls. */
function fakeIfthenpay(script: Array<unknown | "timeout">, delayMs = 0) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const next = script.shift() ?? { Code: 1 };
    if (next === "timeout") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const provider = (fetchImpl: typeof fetch) =>
  new IfthenpayProvider({ mbWayKey: "ABC-123456", backofficeKey: "bo", fallback: null, fetchImpl, journal: pgJournal });

const chargeInput = (key: string, cents: number) => ({
  idempotencyKey: key,
  requestId: key,
  method: "mbway" as const,
  amountCents: cents,
  currency: "EUR" as const,
  phone: "+351912345678",
});

const remoteId = () => randomUUID().replace(/-/g, "").slice(0, 20);

describe("ifthenpay journal (Postgres)", () => {
  it("sends a refund key once, even from a second process", async () => {
    const ref = `ifp_${remoteId()}`;
    const key = `refund:${randomUUID()}:no_play`;
    const a = fakeIfthenpay([{ Code: 1 }]);
    const first = await provider(a.fetchImpl).refund(ref, 700, key);
    const b = fakeIfthenpay([{ Code: 1 }]);
    await expect(provider(b.fetchImpl).refund(ref, 700, key)).resolves.toEqual(first);
    expect(b.calls).toHaveLength(0);
  });

  it("a timed-out refund is never re-sent", async () => {
    const key = `refund:${randomUUID()}:no_play`;
    const a = fakeIfthenpay(["timeout"]);
    await expect(provider(a.fetchImpl).refund(`ifp_${remoteId()}`, 300, key)).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    const b = fakeIfthenpay([{ Code: 1 }]);
    await expect(provider(b.fetchImpl).refund(`ifp_${remoteId()}`, 300, key)).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    expect(b.calls).toHaveLength(0);
  });

  it("concurrent refunds of one payment stay within what was paid", async () => {
    const rid = remoteId();
    const charge = fakeIfthenpay([{ RequestId: rid, Status: "000" }]);
    const paid = await provider(charge.fetchImpl).charge(chargeInput(`topup:${randomUUID()}`, 1000));
    expect(paid.providerRef).toBe(`ifp_${rid}`);

    const fake = fakeIfthenpay([{ Code: 1 }, { Code: 1 }], 50);
    const p = provider(fake.fetchImpl);
    const results = await Promise.allSettled([
      p.refund(paid.providerRef, 700, `wallet:${randomUUID()}`),
      p.refund(paid.providerRef, 700, `wallet:${randomUUID()}`),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);
  });

  it("refunds an orphan MB WAY payment once, with an audit trail", async () => {
    vi.resetModules();
    const key = `topup:${randomUUID()}`;
    const rid = remoteId();
    const timedOut = fakeIfthenpay(["timeout"]);
    await expect(provider(timedOut.fetchImpl).charge(chargeInput(key, 1250))).rejects.toBeInstanceOf(
      PaymentOutcomeUnknownError,
    );

    // The worker refunds through the app's provider: point it at a fake.
    const refunds = fakeIfthenpay([{ Code: 1 }, { Code: 1 }]);
    vi.doMock("@/lib/payments", async (orig) => ({
      ...(await orig<typeof import("@/lib/payments")>()),
      getPaymentProvider: async () => provider(refunds.fetchImpl),
    }));
    const service = await import("@/lib/payments/service");

    const now = Date.now();
    expect(await service.noteOrphanMbwayPayment(orderIdFor(key), `ifp_${rid}`, now - 120_000)).toBe(true);
    expect(await service.noteOrphanMbwayPayment("zzzzzzzzzzzzzzz", `ifp_${remoteId()}`, now)).toBe(false);

    expect(await service.refundMbwayOrphans(now)).toBeGreaterThanOrEqual(1);
    expect(refunds.calls.filter((u) => u.endsWith("/endpoint/payments/refund"))).toHaveLength(1);
    // Second pass: already settled, nothing sent.
    await service.refundMbwayOrphans(now);
    expect(refunds.calls).toHaveLength(1);

    const audit = await db.query<{ action: string; payload: { amountCents?: number } }>(
      `select action, payload from public.audit_log where entity = 'payment' and entity_id = $1 order by id`,
      [`ifp_${rid}`],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["payment.orphan_detected", "payment.orphan_refunded"]);
    expect(audit.rows[1]!.payload.amountCents).toBe(1250);
  });
});
