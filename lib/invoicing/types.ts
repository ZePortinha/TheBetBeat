/**
 * InvoicingProvider (B4.5): AT-certified invoicing software adapter.
 * Fatura-recibo with optional NIF; VAT-inclusive prices. Mock until Phase 8.
 */
export interface InvoiceInput {
  requestId: string;
  guestId: string;
  amountCents: number;
  vatRate: number; // e.g. 23
  nif?: string;
  email?: string;
  description: string;
}

export interface InvoiceResult {
  providerRef: string;
  pdfUrl: string | null;
  status: "issued" | "failed";
}

export interface InvoicingProvider {
  readonly name: string;
  issueReceipt(input: InvoiceInput): Promise<InvoiceResult>;
}
