/**
 * MockPaymentProvider — simulates the PSP from day one (BRIEF B4.3).
 *
 * Design
 * ------
 * - Intents live in an in-process Map KEYED by providerRef. That Map is the
 *   "PSP's database": the app never reaches into it directly.
 * - CONFIRMATION always flows through signed webhooks (see webhooks.ts). The
 *   dev panel / tests call a `simulate*` helper, which mutates the mock PSP's
 *   state and returns a WebhookEvent; the caller signs it with
 *   `buildWebhook()` / `buildMockWebhook()` and POSTs it to the app's webhook
 *   route. The app therefore behaves exactly as it will with a real PSP
 *   across processes (Phase 8 swaps the adapter, not the flow).
 * - Clock: `now` (epoch ms) is injected via the constructor; `Date.now` is
 *   only the default at this adapter edge, never inside domain logic.
 * - Money: integer cents everywhere.
 *
 * Flows (BRIEF B4.3)
 * ------------------
 * - card / apple_pay / google_pay → authorize() returns 'authorized'
 *   immediately (providerRef 'mock_auth_<uuid>'); capture when the track
 *   plays, void when nothing plays.
 * - mbway → charge() returns 'pending' with expiresAt = now + 4 min (default,
 *   configurable), providerRef 'mock_mbway_<uuid>'. The guest "confirms" via
 *   simulateMbwayConfirmation → payment.confirmed webhook.
 *
 * Idempotency
 * -----------
 * Every operation takes a key unique per logical operation. A repeated key
 * returns the memoized result object (the SAME object) without re-applying
 * the operation. Only definitive results are memoized; a simulated transient
 * failure throws WITHOUT memoizing — like a real PSP, a network error has no
 * idempotent response, so the retry with the same key can succeed.
 *
 * Failure simulation hooks (tests + dev panel)
 * --------------------------------------------
 * - phone '+351900000001' → charge() returns 'failed' immediately.
 * - phone '+351900000002' → stays 'pending' forever (confirmation refused);
 *   getStatus() lazily flips it to 'expired' once now >= expiresAt.
 * - capture amountCents ending in 99 → the first capture attempt on that
 *   intent throws a transient error, the retry succeeds (retry testing).
 */
import { randomUUID } from "node:crypto";
import type { PaymentMethod, PaymentStatus } from "@/lib/domain/types";
import type {
  AuthorizeInput,
  PaymentIntentResult,
  PaymentProvider,
  WebhookEvent,
} from "./types";
import { buildMockWebhook, verifySignedWebhook } from "./webhooks";

/** MB WAY push timeout — 4 min by default, configurable per BRIEF B4.3. */
export const MBWAY_DEFAULT_TIMEOUT_MS = 4 * 60_000;

/** charge() to this phone fails immediately ('failed'). */
export const MOCK_MBWAY_FAIL_PHONE = "+351900000001";
/** charge() to this phone is never confirmed — it stays pending and expires. */
export const MOCK_MBWAY_NEVER_CONFIRM_PHONE = "+351900000002";

interface MockIntent {
  providerRef: string;
  method: PaymentMethod;
  /** Authorized (card/wallet) or charged (MB WAY) amount. */
  amountCents: number;
  capturedCents: number;
  refundedCents: number;
  status: PaymentStatus;
  expiresAtMs?: number;
  phone?: string;
}

export interface MockPaymentProviderOptions {
  /** Shared secret for webhook HMAC signatures (env.PAYMENT_WEBHOOK_SECRET). */
  webhookSecret: string;
  /** Injected clock, epoch ms. Tests pass a fixed/steppable clock. */
  now?: () => number;
  /** MB WAY push timeout override (default 4 min). */
  mbwayTimeoutMs?: number;
}

function assertCents(amountCents: number, label: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`mock: ${label} must be a positive integer of cents`);
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  private readonly intents = new Map<string, MockIntent>();
  /** idempotencyKey → the exact result object returned the first time. */
  private readonly memoized = new Map<string, PaymentIntentResult>();
  /** providerRefs whose "amount ends in 99" capture already failed once. */
  private readonly captureFailedOnce = new Set<string>();

  private readonly webhookSecret: string;
  private readonly now: () => number;
  private readonly mbwayTimeoutMs: number;

  constructor(options: MockPaymentProviderOptions) {
    this.webhookSecret = options.webhookSecret;
    this.now = options.now ?? (() => Date.now());
    this.mbwayTimeoutMs = options.mbwayTimeoutMs ?? MBWAY_DEFAULT_TIMEOUT_MS;
  }

  // ── PaymentProvider ────────────────────────────────────────────────────

  async authorize(input: AuthorizeInput): Promise<PaymentIntentResult> {
    const memo = this.memoized.get(input.idempotencyKey);
    if (memo) return memo;

    if (input.method === "mbway") {
      throw new Error("mock: MB WAY is an immediate charge — use charge()");
    }
    assertCents(input.amountCents, "amountCents");

    const providerRef = `mock_auth_${randomUUID()}`;
    const intent: MockIntent = {
      providerRef,
      method: input.method,
      amountCents: input.amountCents,
      capturedCents: 0,
      refundedCents: 0,
      status: "authorized",
    };
    this.intents.set(providerRef, intent);

    const result: PaymentIntentResult = {
      providerRef,
      status: "authorized",
      clientAction: { kind: "none" },
    };
    this.memoized.set(input.idempotencyKey, result);
    return result;
  }

  async charge(input: AuthorizeInput): Promise<PaymentIntentResult> {
    const memo = this.memoized.get(input.idempotencyKey);
    if (memo) return memo;

    if (input.method !== "mbway") {
      throw new Error("mock: charge() is MB WAY only — use authorize()");
    }
    assertCents(input.amountCents, "amountCents");
    if (!input.phone) {
      throw new Error("mock: MB WAY requires a phone number (+351…)");
    }

    const providerRef = `mock_mbway_${randomUUID()}`;

    if (input.phone === MOCK_MBWAY_FAIL_PHONE) {
      const intent: MockIntent = {
        providerRef,
        method: "mbway",
        amountCents: input.amountCents,
        capturedCents: 0,
        refundedCents: 0,
        status: "failed",
        phone: input.phone,
      };
      this.intents.set(providerRef, intent);
      const failed: PaymentIntentResult = { providerRef, status: "failed" };
      this.memoized.set(input.idempotencyKey, failed);
      return failed;
    }

    const expiresAtMs = this.now() + this.mbwayTimeoutMs;
    const intent: MockIntent = {
      providerRef,
      method: "mbway",
      amountCents: input.amountCents,
      capturedCents: 0,
      refundedCents: 0,
      status: "pending",
      expiresAtMs,
      phone: input.phone,
    };
    this.intents.set(providerRef, intent);

    const result: PaymentIntentResult = {
      providerRef,
      status: "pending",
      expiresAt: new Date(expiresAtMs).toISOString(),
      clientAction: { kind: "none" },
    };
    this.memoized.set(input.idempotencyKey, result);
    return result;
  }

  async capture(
    providerRef: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult> {
    const memo = this.memoized.get(idempotencyKey);
    if (memo) return memo;

    const intent = this.requireIntent(providerRef);
    assertCents(amountCents, "amountCents");
    if (intent.status !== "authorized") {
      throw new Error(
        `mock: cannot capture intent in status '${intent.status}'`,
      );
    }
    if (amountCents > intent.amountCents) {
      throw new Error(
        `mock: capture of ${amountCents} exceeds authorized amount ${intent.amountCents}`,
      );
    }

    // Transient-failure hook: an amount ending in 99 fails once per intent,
    // then succeeds on retry. Not memoized (see "Idempotency" above).
    if (amountCents % 100 === 99 && !this.captureFailedOnce.has(providerRef)) {
      this.captureFailedOnce.add(providerRef);
      throw new Error("mock: simulated transient network failure — retry");
    }

    intent.capturedCents = amountCents;
    intent.status = "captured";

    const result: PaymentIntentResult = { providerRef, status: "captured" };
    this.memoized.set(idempotencyKey, result);
    return result;
  }

  async void(
    providerRef: string,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult> {
    const memo = this.memoized.get(idempotencyKey);
    if (memo) return memo;

    const intent = this.requireIntent(providerRef);
    if (intent.status !== "authorized") {
      throw new Error(`mock: cannot void intent in status '${intent.status}'`);
    }
    intent.status = "voided";

    const result: PaymentIntentResult = { providerRef, status: "voided" };
    this.memoized.set(idempotencyKey, result);
    return result;
  }

  /**
   * Refunds succeed by RESOLVING and fail by THROWING — PaymentStatus has no
   * refund states (the app tracks RefundStatus in its own tables), so the
   * returned `status` simply echoes the underlying intent ('captured') and
   * `providerRef` is the refund's own reference ('mock_rf_<uuid>').
   */
  async refund(
    providerRef: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult> {
    const memo = this.memoized.get(idempotencyKey);
    if (memo) return memo;

    const intent = this.intents.get(providerRef);
    if (!intent) {
      // Refunds run in the worker process, which never saw the intent that the
      // Next process created (this mock is in-memory). A real PSP is a shared
      // remote service; the payments table already caps the refundable amount.
      assertCents(amountCents, "amountCents");
      const result: PaymentIntentResult = {
        providerRef: `mock_rf_${randomUUID()}`,
        status: "captured",
      };
      this.memoized.set(idempotencyKey, result);
      return result;
    }
    assertCents(amountCents, "amountCents");
    if (intent.capturedCents === 0) {
      throw new Error("mock: nothing captured to refund");
    }
    const refundable = intent.capturedCents - intent.refundedCents;
    if (amountCents > refundable) {
      throw new Error(
        `mock: refund of ${amountCents} exceeds refundable amount ${refundable}`,
      );
    }
    intent.refundedCents += amountCents;

    const result: PaymentIntentResult = {
      providerRef: `mock_rf_${randomUUID()}`,
      status: intent.status,
    };
    this.memoized.set(idempotencyKey, result);
    return result;
  }

  async getStatus(providerRef: string): Promise<PaymentIntentResult> {
    const intent = this.requireIntent(providerRef);
    this.lazyExpire(intent);

    const result: PaymentIntentResult = {
      providerRef,
      status: intent.status,
    };
    if (intent.status === "pending" && intent.expiresAtMs !== undefined) {
      result.expiresAt = new Date(intent.expiresAtMs).toISOString();
    }
    return result;
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
  ): Promise<WebhookEvent | null> {
    return verifySignedWebhook(rawBody, signature, this.webhookSecret);
  }

  // ── Simulation surface (dev panel, tests, scripts/simulate) ───────────
  // Each helper mutates the mock PSP's state and returns the WebhookEvent a
  // real PSP would deliver. Event ids are deterministic per (intent, type):
  // a duplicate delivery of the same event carries the same id, so the app's
  // webhook route can dedupe.

  /** Guest approved the MB WAY push → payment.confirmed. */
  simulateMbwayConfirmation(providerRef: string): WebhookEvent {
    const intent = this.requireIntent(providerRef);
    this.lazyExpire(intent);
    if (intent.phone === MOCK_MBWAY_NEVER_CONFIRM_PHONE) {
      throw new Error(
        `mock: ${MOCK_MBWAY_NEVER_CONFIRM_PHONE} never confirms (simulation hook)`,
      );
    }
    // Already captured: re-send the webhook, as a PSP retries a lost delivery.
    if (intent.method === "mbway" && intent.status === "captured") {
      return this.makeEvent(intent, "payment.confirmed", intent.capturedCents);
    }
    if (intent.method !== "mbway" || intent.status !== "pending") {
      throw new Error(
        `mock: cannot confirm intent in status '${intent.status}'`,
      );
    }
    intent.status = "captured";
    intent.capturedCents = intent.amountCents;
    return this.makeEvent(intent, "payment.confirmed", intent.amountCents);
  }

  /** Guest declined the MB WAY push → payment.failed. */
  simulateMbwayDecline(providerRef: string): WebhookEvent {
    const intent = this.requireIntent(providerRef);
    if (intent.method !== "mbway" || intent.status !== "pending") {
      throw new Error(
        `mock: cannot decline intent in status '${intent.status}'`,
      );
    }
    intent.status = "failed";
    return this.makeEvent(intent, "payment.failed");
  }

  /** The push timed out → payment.expired (worker-driven in the real flow). */
  simulateMbwayExpiry(providerRef: string): WebhookEvent {
    const intent = this.requireIntent(providerRef);
    if (intent.method !== "mbway" || intent.status !== "pending") {
      throw new Error(
        `mock: cannot expire intent in status '${intent.status}'`,
      );
    }
    intent.status = "expired";
    return this.makeEvent(intent, "payment.expired");
  }

  /** Sign an event with this provider's secret, ready to POST to the app. */
  buildWebhook(event: WebhookEvent): { rawBody: string; signature: string } {
    return buildMockWebhook(event, this.webhookSecret);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private requireIntent(providerRef: string): MockIntent {
    const intent = this.intents.get(providerRef);
    if (!intent) {
      throw new Error(`mock: unknown providerRef '${providerRef}'`);
    }
    return intent;
  }

  /** A pending MB WAY charge past its deadline flips to 'expired'. */
  private lazyExpire(intent: MockIntent): void {
    if (
      intent.status === "pending" &&
      intent.expiresAtMs !== undefined &&
      this.now() >= intent.expiresAtMs
    ) {
      intent.status = "expired";
    }
  }

  private makeEvent(
    intent: MockIntent,
    type: WebhookEvent["type"],
    amountCents?: number,
  ): WebhookEvent {
    const event: WebhookEvent = {
      // Deterministic per (intent, type) so duplicates share the same id.
      id: `evt_${intent.providerRef}_${type}`,
      providerRef: intent.providerRef,
      type,
      raw: { mock: true, phone: intent.phone ?? null },
    };
    if (amountCents !== undefined) event.amountCents = amountCents;
    return event;
  }
}
