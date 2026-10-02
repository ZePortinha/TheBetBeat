/**
 * MockInvoicingProvider (B4.5) — stands in for AT-certified invoicing software
 * until Phase 8. Issues a fatura-recibo (VAT-inclusive price, optional NIF)
 * and records every attempt in an in-memory outbox for tests and the dev
 * panel. Idempotent per requestId, like the real adapter must be.
 */
import type {
  InvoiceInput,
  InvoiceResult,
  InvoicingProvider,
} from "@/lib/invoicing/types";

export interface InvoiceOutboxEntry {
  /** Monotonic ordering for tests/dev panel (no wall clock in domain code). */
  readonly seq: number;
  readonly input: InvoiceInput;
  readonly result: InvoiceResult;
  /** Why issuing failed, when it did (dev panel only — never shown to guests). */
  readonly error?: string;
}

/** In-memory outbox — exported for tests and the dev panel. */
export const invoiceOutbox: InvoiceOutboxEntry[] = [];

let seq = 0;

/** Reset the outbox (test isolation / dev panel "clear" button). */
export function clearInvoiceOutbox(): void {
  invoiceOutbox.length = 0;
  seq = 0;
}

/**
 * Portuguese NIF validation (pure): 9 digits, first digit non-zero, mod-11
 * check digit. The check digit is 11 − (Σ dᵢ·(9−i) mod 11) over the first
 * 8 digits, with remainders 0 and 1 both mapping to check digit 0.
 * Accepts surrounding whitespace and an optional "PT" prefix (checkout input).
 */
export function validateNif(nif: string): boolean {
  const digits = nif.replace(/\s+/g, "").replace(/^PT/i, "");
  if (!/^[1-9]\d{8}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += (digits.charCodeAt(i) - 48) * (9 - i);
  }
  const mod = sum % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  return check === digits.charCodeAt(8) - 48;
}

/** Returns a human-readable problem, or null when the input can be invoiced. */
function findInputProblem(input: InvoiceInput): string | null {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return "amountCents must be a positive integer (cents)";
  }
  if (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 100) {
    return "vatRate must be a percentage between 0 and 100";
  }
  if (input.description.trim().length === 0) {
    return "description must not be empty";
  }
  if (input.nif !== undefined && input.nif.trim() !== "" && !validateNif(input.nif)) {
    return "nif failed the Portuguese check-digit validation";
  }
  return null;
}

export class MockInvoicingProvider implements InvoicingProvider {
  readonly name = "mock-invoicing";

  async issueReceipt(input: InvoiceInput): Promise<InvoiceResult> {
    // Idempotency: one receipt per request. A duplicate call returns the
    // original result; failed attempts may be retried.
    const prior = invoiceOutbox.find(
      (e) => e.input.requestId === input.requestId && e.result.status === "issued",
    );
    if (prior) return prior.result;

    const providerRef = `mock_inv_${crypto.randomUUID()}`;
    const problem = findInputProblem(input);
    const result: InvoiceResult = {
      providerRef,
      pdfUrl: null,
      status: problem === null ? "issued" : "failed",
    };
    invoiceOutbox.push(
      problem === null
        ? { seq: ++seq, input, result }
        : { seq: ++seq, input, result, error: problem },
    );
    // No NIF/email in logs (B12 / RGPD) — the outbox holds the details.
    console.info(
      `[invoicing] ${this.name}: ${result.status} ref=${providerRef} request=${input.requestId}` +
        (problem === null ? "" : ` (${problem})`),
    );
    return result;
  }
}
