/**
 * PSP operation journal (2026-10-06). ifthenpay has no idempotency keys, so
 * the adapter makes its own: every MB WAY push and every refund claims its
 * idempotency key here BEFORE the HTTP call and records the outcome after.
 *
 *  - done     → the outcome is known; the same key returns the stored result.
 *  - refused  → the PSP said no and nothing moved; the key may be re-sent.
 *  - sending  → a call is in flight (or the process died mid-call).
 *  - unknown  → the call timed out or broke: money may have moved.
 *
 * `sending`/`unknown` are never re-sent automatically: a second refund would
 * pay the guest twice. They raise PaymentOutcomeUnknownError and wait for an
 * admin (docs/INTEGRATIONS.md, "Resultado desconhecido").
 *
 * Refunds are also capped per payment: done + in-flight + unknown refunds
 * can never exceed what the guest paid, whatever key they use.
 *
 * The Postgres implementation is journal-pg.ts; this file stays pure so the
 * adapter is testable without a database.
 */
import type { PaymentIntentResult } from "./types";

export type PspOperationKind = "charge" | "refund";
export type PspOperationState = "sending" | "done" | "refused" | "unknown";

export interface PspOperation {
  key: string;
  kind: PspOperationKind;
  state: PspOperationState;
  /** charge: the payment's reference once known · refund: the payment refunded. */
  providerRef: string | null;
  /** charge only: the orderId sent to the PSP. */
  orderId: string | null;
  amountCents: number;
  result: PaymentIntentResult | null;
  /** charge only: set when a confirmed payment reached us (callback/poll). */
  paidAt: string | null;
}

export interface ClaimInput {
  key: string;
  kind: PspOperationKind;
  providerRef: string | null;
  orderId: string | null;
  amountCents: number;
}

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: "exists"; existing: PspOperation }
  | { claimed: false; reason: "over_cap"; chargedCents: number; refundedCents: number };

export interface PspJournal {
  /**
   * Claims `key` for a new PSP call (state `sending`). An existing key is
   * returned as is, except `refused`, which is claimed again. A refund over
   * the payment's cap is not claimed.
   */
  claim(input: ClaimInput): Promise<ClaimResult>;
  finish(
    key: string,
    state: Exclude<PspOperationState, "sending">,
    fields?: { providerRef?: string; result?: PaymentIntentResult; error?: string },
  ): Promise<void>;
  /**
   * A confirmed MB WAY payment reached us (verified with the status API).
   * Links the charge with `orderId` to its reference. Returns the charge, or
   * null when the order is not ours.
   */
  markPaid(orderId: string, providerRef: string, at: string): Promise<PspOperation | null>;
}

/** The PSP call broke mid-way (timeout, network, 5xx): money may have moved. */
export class PaymentOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentOutcomeUnknownError";
  }
}

const COUNTS_AS_REFUNDED: ReadonlySet<PspOperationState> = new Set(["sending", "done", "unknown"]);

/** Cap check shared by both implementations. */
export function refundCap(
  ops: Iterable<PspOperation>,
  input: ClaimInput,
): { chargedCents: number; refundedCents: number } | null {
  let charged: number | null = null;
  let refunded = 0;
  for (const op of ops) {
    if (op.providerRef !== input.providerRef || op.key === input.key) continue;
    if (op.kind === "charge" && (op.state === "done" || op.paidAt !== null)) charged = op.amountCents;
    if (op.kind === "refund" && COUNTS_AS_REFUNDED.has(op.state)) refunded += op.amountCents;
  }
  // Payments made before the journal existed have no charge row: no cap.
  if (charged === null || refunded + input.amountCents <= charged) return null;
  return { chargedCents: charged, refundedCents: refunded };
}

/** In-process journal: tests and the development fallback. */
export class MemoryJournal implements PspJournal {
  readonly ops = new Map<string, PspOperation>();

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const existing = this.ops.get(input.key);
    if (existing && existing.state !== "refused") return { claimed: false, reason: "exists", existing };
    if (input.kind === "refund") {
      const over = refundCap(this.ops.values(), input);
      if (over) return { claimed: false, reason: "over_cap", ...over };
    }
    this.ops.set(input.key, {
      ...input,
      state: "sending",
      result: null,
      paidAt: existing?.paidAt ?? null,
    });
    return { claimed: true };
  }

  async finish(
    key: string,
    state: Exclude<PspOperationState, "sending">,
    fields: { providerRef?: string; result?: PaymentIntentResult; error?: string } = {},
  ): Promise<void> {
    const op = this.ops.get(key);
    if (!op) return;
    op.state = state;
    if (fields.providerRef !== undefined) op.providerRef = fields.providerRef;
    if (fields.result !== undefined) op.result = fields.result;
  }

  async markPaid(orderId: string, providerRef: string, at: string): Promise<PspOperation | null> {
    for (const op of this.ops.values()) {
      if (op.kind !== "charge" || op.orderId !== orderId) continue;
      op.providerRef = providerRef;
      op.paidAt ??= at;
      return op;
    }
    return null;
  }
}
