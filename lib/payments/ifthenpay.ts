/**
 * ifthenpay MB WAY adapter (2026-10-06) — real MB WAY push requests.
 *
 * API (https://ifthenpay.com/docs/en/api/mbway/, /api/refund/):
 *   POST https://api.ifthenpay.com/spg/payment/mbway
 *        { mbWayKey, orderId (≤15), amount "10.99", mobileNumber "351#912345678", description }
 *        → { RequestId, Status: "000" pending | "100"/"122"/"999" failed }
 *   GET  https://api.ifthenpay.com/spg/payment/mbway/status?mbWayKey&requestId
 *        → Status "000" paid | "020" rejected | "101" expired (4 min) | "122" declined
 *   POST https://api.ifthenpay.com/v2/payments/refund { backofficekey, requestId, amount }
 *        → Code 1 ok | 0 failed | -1 insufficient funds (only money not yet
 *          settled to the merchant — roughly since 20:00 the day before)
 *   Callback (GET, configured in ifthenpay): see app/api/webhooks/ifthenpay.
 *
 * Only MB WAY lives here. Other methods go to `fallback` (the mock in
 * development) and are unavailable in production until a card gateway is
 * added. References are 'ifp_<RequestId>' so ref-based calls route back.
 */
import { createHash } from "node:crypto";
import type { AuthorizeInput, PaymentIntentResult, PaymentProvider, WebhookEvent } from "./types";

export const IFTHENPAY_REF_PREFIX = "ifp_";
const API = "https://api.ifthenpay.com";
const MBWAY_TIMEOUT_MS = 4 * 60_000;
const HTTP_TIMEOUT_MS = 10_000;

export interface IfthenpayConfig {
  mbWayKey: string;
  backofficeKey: string;
  fallback: PaymentProvider | null;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** "+351912345678" → "351#912345678" (MB WAY is Portuguese numbers only). */
export function toMbwayNumber(e164: string): string {
  const m = /^\+351(9\d{8})$/.exec(e164);
  if (!m) throw new Error("ifthenpay: MB WAY needs a +351 9xxxxxxxx number");
  return `351#${m[1]}`;
}

/** Deterministic order id (≤ 15 chars) for an idempotency key. */
export function orderIdFor(idempotencyKey: string): string {
  return BigInt(`0x${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20)}`)
    .toString(36)
    .slice(0, 15);
}

const euros = (cents: number) => (cents / 100).toFixed(2);

export class IfthenpayProvider implements PaymentProvider {
  readonly name = "ifthenpay";
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  /** Same key twice in one process → the same push, never a second one. */
  private readonly memo = new Map<string, PaymentIntentResult>();

  constructor(private readonly cfg: IfthenpayConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  private isOurs(ref: string): boolean {
    return ref.startsWith(IFTHENPAY_REF_PREFIX);
  }

  private other(): PaymentProvider {
    if (!this.cfg.fallback) throw new Error("payment_method_unavailable");
    return this.cfg.fallback;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ifthenpay: HTTP ${res.status} on ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }

  async charge(input: AuthorizeInput): Promise<PaymentIntentResult> {
    if (input.method !== "mbway") return this.other().charge(input);
    const memo = this.memo.get(input.idempotencyKey);
    if (memo) return memo;
    if (!input.phone) throw new Error("ifthenpay: MB WAY needs a phone number");

    const body = await this.call<{ RequestId?: string; Status?: string; Message?: string }>("/spg/payment/mbway", {
      method: "POST",
      body: JSON.stringify({
        mbWayKey: this.cfg.mbWayKey,
        orderId: orderIdFor(input.idempotencyKey),
        amount: euros(input.amountCents),
        mobileNumber: toMbwayNumber(input.phone),
        ...(input.email ? { email: input.email } : {}),
        description: "BetBeat",
      }),
    });
    const result: PaymentIntentResult =
      body.Status === "000" && body.RequestId
        ? {
            providerRef: `${IFTHENPAY_REF_PREFIX}${body.RequestId}`,
            status: "pending",
            expiresAt: new Date(this.now() + MBWAY_TIMEOUT_MS).toISOString(),
            clientAction: { kind: "none" },
          }
        : { providerRef: `${IFTHENPAY_REF_PREFIX}failed_${orderIdFor(input.idempotencyKey)}`, status: "failed" };
    this.memo.set(input.idempotencyKey, result);
    return result;
  }

  async getStatus(providerRef: string): Promise<PaymentIntentResult> {
    if (!this.isOurs(providerRef)) return this.other().getStatus(providerRef);
    const requestId = providerRef.slice(IFTHENPAY_REF_PREFIX.length);
    const body = await this.call<{ Status?: string }>(
      `/spg/payment/mbway/status?mbWayKey=${encodeURIComponent(this.cfg.mbWayKey)}&requestId=${encodeURIComponent(requestId)}`,
    );
    const status =
      body.Status === "000"
        ? "captured"
        : body.Status === "101"
          ? "expired"
          : body.Status === "020" || body.Status === "122"
            ? "failed"
            : "pending";
    return { providerRef, status };
  }

  /** Resolves on success, throws on failure (same contract as the mock). */
  async refund(providerRef: string, amountCents: number, idempotencyKey: string): Promise<PaymentIntentResult> {
    if (!this.isOurs(providerRef)) return this.other().refund(providerRef, amountCents, idempotencyKey);
    const memo = this.memo.get(idempotencyKey);
    if (memo) return memo;
    const body = await this.call<{ Code?: number | string; Message?: string }>("/v2/payments/refund", {
      method: "POST",
      body: JSON.stringify({
        backofficekey: this.cfg.backofficeKey,
        requestId: providerRef.slice(IFTHENPAY_REF_PREFIX.length),
        amount: euros(amountCents),
      }),
    });
    if (Number(body.Code) !== 1) {
      throw new Error(`ifthenpay refund refused (code ${String(body.Code)}): ${body.Message ?? "unknown"}`);
    }
    const result: PaymentIntentResult = { providerRef: `${providerRef}_rf_${orderIdFor(idempotencyKey)}`, status: "captured" };
    this.memo.set(idempotencyKey, result);
    return result;
  }

  // MB WAY is charged at once: there is no hold to capture or release.
  async authorize(input: AuthorizeInput): Promise<PaymentIntentResult> {
    return this.other().authorize(input);
  }

  async capture(providerRef: string, amountCents: number, idempotencyKey: string): Promise<PaymentIntentResult> {
    if (this.isOurs(providerRef)) return { providerRef, status: "captured" };
    return this.other().capture(providerRef, amountCents, idempotencyKey);
  }

  async void(providerRef: string, idempotencyKey: string): Promise<PaymentIntentResult> {
    if (this.isOurs(providerRef)) throw new Error("ifthenpay: an MB WAY payment is refunded, not voided");
    return this.other().void(providerRef, idempotencyKey);
  }

  /** ifthenpay calls back by GET (app/api/webhooks/ifthenpay); signed JSON webhooks are the mock's. */
  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent | null> {
    return this.cfg.fallback ? this.cfg.fallback.verifyWebhook(rawBody, signature) : null;
  }
}
