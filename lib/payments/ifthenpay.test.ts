import { describe, expect, it, vi } from "vitest";
import { IfthenpayProvider, orderIdFor, toMbwayNumber } from "./ifthenpay";
import type { PaymentProvider } from "./types";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 });
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

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

const make = (responses: unknown[]) => {
  const f = fakeFetch(responses);
  const provider = new IfthenpayProvider({
    mbWayKey: "ABC-123456",
    backofficeKey: "0000-0000-0000-0000",
    fallback,
    fetchImpl: f.impl,
    now: () => 1_000_000,
  });
  return { provider, calls: f.calls };
};

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
    await provider.charge(input);
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
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ requestId: "abc123", amount: "5.00" });
    await expect(provider.refund("ifp_abc123", 500, "k2")).rejects.toThrow(/code -1/);
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
    const provider = new IfthenpayProvider({ mbWayKey: "k", backofficeKey: "b", fallback: null, fetchImpl: fakeFetch([]).impl });
    await expect(provider.authorize({ ...input, method: "card" })).rejects.toThrow("payment_method_unavailable");
  });
});
