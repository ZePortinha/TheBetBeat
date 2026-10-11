import { describe, expect, it, vi } from "vitest";
import { IfthenpayProvider, orderIdFor, toMbwayNumber } from "./ifthenpay";
import { MemoryJournal, PaymentOutcomeUnknownError } from "./journal";
import type { PaymentProvider } from "./types";

type Call = { url: string; init: RequestInit | undefined };

const fallback = {
  name: "fallback",
  charge: vi.fn(async () => ({ providerRef: "mock_x", status: "pending" as const })),
  authorize: vi.fn(async () => ({ providerRef: "mock_auth", status: "authorized" as const })),
  capture: vi.fn(async () => ({ providerRef: "mock_auth", status: "captured" as const })),
  void: vi.fn(),
  refund: vi.fn(),
  getStatus: vi.fn(),
  verifyWebhook: vi.fn(async () => null),
} as unknown as PaymentProvider;

/** A scripted answer: JSON body (200), an HTTP status, or a thrown error. */
type Scripted = unknown | { http: number } | { throws: Error };

function scriptedFetch(script: Scripted[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = script.shift() ?? {};
    if (next && typeof next === "object" && "throws" in next) throw (next as { throws: Error }).throws;
    if (next && typeof next === "object" && "http" in next) return new Response("oops", { status: (next as { http: number }).http });
    return new Response(JSON.stringify(next), { status: 200 });
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

const make = (responses: Scripted[], journal = new MemoryJournal()) => {
  const f = scriptedFetch(responses);
  const provider = new IfthenpayProvider({
    mbWayKey: "ABC-123456",
    backofficeKey: "0000-0000-0000-0000",
    fallback,
    fetchImpl: f.impl,
    now: () => 1_000_000,
    journal,
  });
  return { provider, calls: f.calls, journal };
};

const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

const input = {
  idempotencyKey: "topup:1f0f0f0f-0000-4000-8000-000000000001",
  requestId: "r1",
  method: "mbway" as const,
  amountCents: 1050,
  currency: "EUR" as const,
  phone: "+351912345678",
};

describe("ifthenpay MB WAY", () => {
  it("formats the number and a short, stable order id", () => {
    expect(toMbwayNumber("+351912345678")).toBe("351#912345678");
    expect(() => toMbwayNumber("+34612345678")).toThrow();
    expect(orderIdFor("a")).toBe(orderIdFor("a"));
    expect(orderIdFor("a").length).toBeLessThanOrEqual(15);
  });

  it("sends a real MB WAY request and waits for the guest (4 minutes)", async () => {
    const { provider, calls } = make([{ RequestId: "i2szvoUfPYBMWdSxqO3n", Status: "000", Message: "Pending" }]);
    const result = await provider.charge(input);
    expect(result).toMatchObject({ providerRef: "ifp_i2szvoUfPYBMWdSxqO3n", status: "pending" });
    expect(result.expiresAt).toBe(new Date(1_000_000 + 4 * 60_000).toISOString());
    expect(calls[0]!.url).toBe("https://api.ifthenpay.com/spg/payment/mbway");
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      mbWayKey: "ABC-123456",
      amount: "10.50",
      mobileNumber: "351#912345678",
    });
    // Same idempotency key: no second push to the guest's phone.
    await expect(provider.charge(input)).resolves.toEqual(result);
    expect(calls).toHaveLength(1);
  });

  it("reports a refused request as failed", async () => {
    const { provider } = make([{ Status: "122", Message: "declined" }]);
    expect((await provider.charge(input)).status).toBe("failed");
  });

  it("maps the status codes", async () => {
    const { provider } = make([{ Status: "000" }, { Status: "101" }, { Status: "020" }, { Status: "123" }]);
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await provider.getStatus("ifp_abc123")).status);
    expect(statuses).toEqual(["captured", "expired", "failed", "pending"]);
  });

  it("refunds with Code 1 and throws otherwise", async () => {
    const { provider, calls } = make([{ Code: 1 }, { Code: -1, Message: "Insufficient funds" }]);
    await expect(provider.refund("ifp_abc123", 500, "k1")).resolves.toMatchObject({ status: "captured" });
    expect(calls[0]!.url).toBe("https://api.ifthenpay.com/endpoint/payments/refund");
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      backofficekey: "0000-0000-0000-0000",
      requestId: "abc123",
      amount: "5.00",
    });
    await expect(provider.refund("ifp_abc123", 500, "k2")).rejects.toThrow(/code -1/);
  });

  it("never sends the same refund twice, even from a new process", async () => {
    const journal = new MemoryJournal();
    const first = make([{ Code: 1 }], journal);
    const done = await first.provider.refund("ifp_abc123", 500, "refund:r1:no_play");
    // A restarted worker (new provider, same journal) retries the same key.
    const second = make([{ Code: 1 }], journal);
    await expect(second.provider.refund("ifp_abc123", 500, "refund:r1:no_play")).resolves.toEqual(done);
    expect(second.calls).toHaveLength(0);
  });

  it("a refund that timed out is never re-sent: outcome unknown", async () => {
    const { provider, calls, journal } = make([{ throws: timeout() }, { Code: 1 }]);
    await expect(provider.refund("ifp_abc123", 500, "k1")).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    expect(journal.ops.get("k1")?.state).toBe("unknown");
    await expect(provider.refund("ifp_abc123", 500, "k1")).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    expect(calls).toHaveLength(1);
  });

  it("an unknown refund an admin marked done is booked without calling ifthenpay", async () => {
    const { provider, calls, journal } = make([{ throws: timeout() }]);
    await expect(provider.refund("ifp_abc123", 500, "k1")).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    journal.ops.get("k1")!.state = "done"; // checked in the backoffice
    await expect(provider.refund("ifp_abc123", 500, "k1")).resolves.toMatchObject({ status: "captured" });
    expect(calls).toHaveLength(1);
  });

  it("a 5xx or an unreadable answer leaves the refund unknown; a 4xx can be retried", async () => {
    const { provider, calls, journal } = make([{ http: 502 }, { http: 400 }, { Code: 1 }]);
    await expect(provider.refund("ifp_abc123", 100, "k5xx")).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    await expect(provider.refund("ifp_abc123", 100, "k4xx")).rejects.toThrow(/HTTP 400/);
    expect(journal.ops.get("k4xx")?.state).toBe("refused");
    await expect(provider.refund("ifp_abc123", 100, "k4xx")).resolves.toMatchObject({ status: "captured" });
    expect(calls).toHaveLength(3);
  });

  it("a definite refusal (Code 0/-1) can be retried later", async () => {
    const { provider, calls } = make([{ Code: -1, Message: "Insufficient funds" }, { Code: 1 }]);
    await expect(provider.refund("ifp_abc123", 500, "k1")).rejects.toThrow(/code -1/);
    await expect(provider.refund("ifp_abc123", 500, "k1")).resolves.toMatchObject({ status: "captured" });
    expect(calls).toHaveLength(2);
  });

  it("never refunds more than the guest paid for one MB WAY payment", async () => {
    const { provider, calls } = make([{ RequestId: "abc123xyz", Status: "000" }, { Code: 1 }, { Code: 1 }]);
    const paid = await provider.charge(input); // 10.50 €
    await provider.refund(paid.providerRef, 800, "wallet:a");
    await expect(provider.refund(paid.providerRef, 300, "wallet:b")).rejects.toThrow(/exceed the 1050c paid/);
    await expect(provider.refund(paid.providerRef, 250, "wallet:c")).resolves.toMatchObject({ status: "captured" });
    expect(calls).toHaveLength(3);
  });

  it("an unknown refund still counts against the cap", async () => {
    const { provider } = make([{ RequestId: "abc123xyz", Status: "000" }, { throws: timeout() }]);
    const paid = await provider.charge(input);
    await expect(provider.refund(paid.providerRef, 1050, "k1")).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    await expect(provider.refund(paid.providerRef, 1, "k2")).rejects.toThrow(/exceed/);
  });

  it("a push that timed out is not re-sent, and its approval is found by orderId", async () => {
    const { provider, calls, journal } = make([{ throws: timeout() }]);
    await expect(provider.charge(input)).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    await expect(provider.charge(input)).rejects.toBeInstanceOf(PaymentOutcomeUnknownError);
    expect(calls).toHaveLength(1);
    // The guest approved it anyway: the callback carries our orderId.
    const op = await journal.markPaid(orderIdFor(input.idempotencyKey), "ifp_late123", "2026-10-06T23:00:00Z");
    expect(op).toMatchObject({ kind: "charge", amountCents: 1050, providerRef: "ifp_late123" });
    expect(await journal.markPaid("notours", "ifp_x", "2026-10-06T23:00:00Z")).toBeNull();
  });

  it("routes other methods and references to the fallback", async () => {
    const { provider, calls } = make([]);
    await provider.charge({ ...input, method: "card" });
    await provider.authorize({ ...input, method: "card" });
    expect(fallback.charge).toHaveBeenCalled();
    expect(fallback.authorize).toHaveBeenCalled();
    expect(await provider.capture("ifp_abc123", 100, "c")).toMatchObject({ status: "captured" });
    await expect(provider.void("ifp_abc123", "v")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("without a fallback (production) other methods are unavailable", async () => {
    const provider = new IfthenpayProvider({ mbWayKey: "k", backofficeKey: "b", fallback: null, fetchImpl: scriptedFetch([]).impl });
    await expect(provider.authorize({ ...input, method: "card" })).rejects.toThrow("payment_method_unavailable");
  });
});
