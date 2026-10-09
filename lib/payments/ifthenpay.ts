/**
 * ifthenpay MB WAY adapter (2026-10-06) — real MB WAY push requests.
 *
 * API (https://ifthenpay.com/docs/en/api/mbway/, /api/refund/):
 *   POST https://api.ifthenpay.com/spg/payment/mbway
 *        { mbWayKey, orderId (≤15), amount "10.99", mobileNumber "351#912345678", description }
 *        → { RequestId, Status: "000" pending | "100"/"122"/"999" failed }
 *   GET  https://api.ifthenpay.com/spg/payment/mbway/status?mbWayKey&requestId
 *        → Status "000" paid | "020" rejected | "101" expired (4 min) | "122" declined
 *   POST https://api.ifthenpay.com/endpoint/payments/refund { backofficekey, requestId, amount }
 *        → Code 1 ok | 0 failed | -1 insufficient funds (only money not yet
 *          settled to the merchant — roughly since 20:00 the day before).
 *        Path checked against ifthenpay's helpdesk ("API - Refunds") and
 *        their Pipedream connector; the earlier /v2/payments/refund was wrong.
 *   Callback (GET, configured in ifthenpay): see app/api/webhooks/ifthenpay.
 *
 * Only MB WAY lives here. Other methods go to `fallback` (the mock in
 * development) and are unavailable in production until a card gateway is
 * added. References are 'ifp_<RequestId>' so ref-based calls route back.
 *
 * ifthenpay has no idempotency keys, so pushes and refunds go through a
 * journal (journal.ts): a key is sent once, and a call that broke mid-way
 * (timeout, network, 5xx) is never re-sent: PaymentOutcomeUnknownError.
 */
import { createHash } from "node:crypto";
import { MemoryJournal, PaymentOutcomeUnknownError, type PspJournal } from "./journal";
import type { AuthorizeInput, PaymentIntentResult, PaymentProvider, WebhookEvent } from "./types";

export const IFTHENPAY_REF_PREFIX = "ifp_";
const API = "https://api.ifthenpay.com";
const MBWAY_TIMEOUT_MS = 4 * 60_000;
const HTTP_TIMEOUT_MS = 10_000;
/** Refunds get longer: a timeout there needs an admin to settle it. */
const REFUND_TIMEOUT_MS = 30_000;

/** ifthenpay answered with an HTTP error: the request was not processed. */
class IfthenpayHttpError extends Error {}

export interface IfthenpayConfig {
  mbWayKey: string;
  backofficeKey: string;
  fallback: PaymentProvider | null;
  /** Postgres in the app (journal-pg.ts); in memory by default. */
  journal?: PspJournal;
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
  private readonly journal: PspJournal;

  constructor(private readonly cfg: IfthenpayConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
    this.journal = cfg.journal ?? new MemoryJournal();
  }

  private isOurs(ref: string): boolean {
    return ref.startsWith(IFTHENPAY_REF_PREFIX);
  }

  private other(): PaymentProvider {
    if (!this.cfg.fallback) throw new Error("payment_method_unavailable");
    return this.cfg.fallback;
  }

  /**
   * 4xx → IfthenpayHttpError (nothing happened). Anything that leaves the
   * outcome open (timeout, network, 5xx, unreadable body) →
   * PaymentOutcomeUnknownError.
   */
  private async call<T>(path: string, init?: RequestInit, timeoutMs = HTTP_TIMEOUT_MS): Promise<T> {
    const where = path.split("?")[0];
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        ...init,
        headers: { "content-type": "application/json", accept: "application/json", ...init?.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const why = error instanceof Error ? error.name : "network";
      throw new PaymentOutcomeUnknownError(`ifthenpay: no answer on ${where} (${why})`);
    }
    if (res.status >= 400 && res.status < 500) throw new IfthenpayHttpError(`ifthenpay: HTTP ${res.status} on ${where}`);
    if (!res.ok) throw new PaymentOutcomeUnknownError(`ifthenpay: HTTP ${res.status} on ${where}`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new PaymentOutcomeUnknownError(`ifthenpay: unreadable answer on ${where}`);
    }
  }

  /** Runs a journaled PSP call: the outcome is recorded whatever happens. */
  private async journaled<T>(key: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      await this.journal.finish(key, error instanceof PaymentOutcomeUnknownError ? "unknown" : "refused", { error: message });
      throw error;
    }
  }

  async charge(input: AuthorizeInput): Promise<PaymentIntentResult> {
    if (input.method !== "mbway") return this.other().charge(input);
    if (!input.phone) throw new Error("ifthenpay: MB WAY needs a phone number");
    const mobileNumber = toMbwayNumber(input.phone);
    const key = input.idempotencyKey;
    const orderId = orderIdFor(key);

    const claim = await this.journal.claim({ key, kind: "charge", providerRef: null, orderId, amountCents: input.amountCents });
    if (!claim.claimed) {
      if (claim.reason === "exists" && claim.existing.state === "done" && claim.existing.result) return claim.existing.result;
      throw new PaymentOutcomeUnknownError("ifthenpay: this MB WAY request was already sent and its outcome is unknown");
    }

    const body = await this.journaled(key, () =>
      this.call<{ RequestId?: string; Status?: string; Message?: string }>("/spg/payment/mbway", {
        method: "POST",
        body: JSON.stringify({
          mbWayKey: this.cfg.mbWayKey,
          orderId,
          amount: euros(input.amountCents),
          mobileNumber,
          ...(input.email ? { email: input.email } : {}),
          description: "BetBeat",
        }),
      }),
    );
    const result: PaymentIntentResult =
      body.Status === "000" && body.RequestId
        ? {
            providerRef: `${IFTHENPAY_REF_PREFIX}${body.RequestId}`,
            status: "pending",
            expiresAt: new Date(this.now() + MBWAY_TIMEOUT_MS).toISOString(),
            clientAction: { kind: "none" },
          }
        : { providerRef: `${IFTHENPAY_REF_PREFIX}failed_${orderId}`, status: "failed" };
    // A refused push is a known outcome too: nothing will be charged.
    await this.journal.finish(key, "done", { providerRef: result.providerRef, result });
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
    const key = idempotencyKey;
    const claim = await this.journal.claim({ key, kind: "refund", providerRef, orderId: null, amountCents });
    if (!claim.claimed) {
      if (claim.reason === "over_cap") {
        throw new Error(
          `ifthenpay refund blocked: ${claim.refundedCents + amountCents}c would exceed the ${claim.chargedCents}c paid`,
        );
      }
      // `done` without a result: an admin confirmed it in the backoffice.
      if (claim.existing.state === "done") return claim.existing.result ?? this.refundResult(providerRef, key);
      throw new PaymentOutcomeUnknownError(
        "ifthenpay: this refund was already sent and its outcome is unknown; check the ifthenpay backoffice",
      );
    }

    const result = await this.journaled(key, async () => {
      const body = await this.call<{ Code?: number | string; Message?: string }>(
        "/endpoint/payments/refund",
        {
          method: "POST",
          body: JSON.stringify({
            backofficekey: this.cfg.backofficeKey,
            requestId: providerRef.slice(IFTHENPAY_REF_PREFIX.length),
            amount: euros(amountCents),
          }),
        },
        REFUND_TIMEOUT_MS,
      );
      if (Number(body.Code) !== 1) {
        throw new Error(`ifthenpay refund refused (code ${String(body.Code)}): ${body.Message ?? "unknown"}`);
      }
      return this.refundResult(providerRef, key);
    });
    await this.journal.finish(key, "done", { result });
    return result;
  }

  private refundResult(providerRef: string, key: string): PaymentIntentResult {
    return { providerRef: `${providerRef}_rf_${orderIdFor(key)}`, status: "captured" };
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
