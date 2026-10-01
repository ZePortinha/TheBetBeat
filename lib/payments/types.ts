/**
 * PaymentProvider interface (BRIEF B4.3). MockPaymentProvider implements this
 * from day one; the real PSP adapter (Phase 8) implements the same surface.
 * All amounts are integer cents. All operations are idempotent.
 */
import type { PaymentMethod, PaymentStatus } from "@/lib/domain/types";

export interface AuthorizeInput {
  /** Unique per logical operation — duplicates must return the original result. */
  idempotencyKey: string;
  requestId: string;
  method: PaymentMethod;
  amountCents: number;
  currency: "EUR";
  /** E.164, required for MB WAY (+351…). */
  phone?: string;
  /** Optional email for card receipts. */
  email?: string;
}

export interface PaymentIntentResult {
  providerRef: string;
  status: PaymentStatus;
  /** For MB WAY: when the push expires (ISO UTC). */
  expiresAt?: string;
  /** Wallet/card flows may need a client secret/redirect — mock returns none. */
  clientAction?: { kind: "none" } | { kind: "redirect"; url: string };
}

export interface WebhookEvent {
  id: string;
  providerRef: string;
  type:
    | "payment.confirmed"
    | "payment.failed"
    | "payment.expired"
    | "refund.succeeded"
    | "refund.failed";
  amountCents?: number;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;

  /** Card/wallet: authorize now, capture when the track plays (B4.3). */
  authorize(input: AuthorizeInput): Promise<PaymentIntentResult>;

  /** Capture part or all of an authorization. */
  capture(
    providerRef: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult>;

  /** Release an authorization that will not be captured. */
  void(providerRef: string, idempotencyKey: string): Promise<PaymentIntentResult>;

  /** MB WAY: immediate charge (push to the guest's phone). */
  charge(input: AuthorizeInput): Promise<PaymentIntentResult>;

  refund(
    providerRef: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult>;

  getStatus(providerRef: string): Promise<PaymentIntentResult>;

  /** Verify a webhook signature and parse the event; null = invalid. */
  verifyWebhook(rawBody: string, signature: string): Promise<WebhookEvent | null>;
}
