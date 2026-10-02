import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the factory touches the server env; the mock provider itself is pure.
vi.mock("@/lib/security/env", () => ({
  env: { INVOICING_PROVIDER: "mock" },
}));

import { getInvoicingProvider } from "@/lib/invoicing";
import {
  clearInvoiceOutbox,
  invoiceOutbox,
  MockInvoicingProvider,
  validateNif,
} from "@/lib/invoicing/mock";
import type { InvoiceInput } from "@/lib/invoicing/types";

/**
 * Independent re-derivation of the Portuguese NIF check digit so the tests
 * verify the algorithm instead of trusting hardcoded examples:
 * check = 11 − (Σ dᵢ·(9−i) mod 11), with remainders 0 and 1 → 0.
 */
function expectedCheckDigit(first8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * (9 - i);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

beforeEach(() => {
  clearInvoiceOutbox();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateNif", () => {
  it("accepts NIFs whose mod-11 check digit is computed correctly", () => {
    // The brief's example prefix plus assorted company/personal prefixes.
    for (const first8 of ["50442629", "12345678", "24456789", "98765432"]) {
      const valid = `${first8}${expectedCheckDigit(first8)}`;
      expect(validateNif(valid), valid).toBe(true);
    }
  });

  it("rejects every wrong check digit for a given prefix", () => {
    const first8 = "50442629";
    const good = expectedCheckDigit(first8);
    for (let d = 0; d <= 9; d++) {
      expect(validateNif(`${first8}${d}`)).toBe(d === good);
    }
  });

  it("accepts the classic 123456789 example (check digit 9)", () => {
    expect(expectedCheckDigit("12345678")).toBe(9);
    expect(validateNif("123456789")).toBe(true);
    expect(validateNif("123456780")).toBe(false);
  });

  it("normalizes whitespace and an optional PT prefix", () => {
    expect(validateNif(" 123 456 789 ")).toBe(true);
    expect(validateNif("PT123456789")).toBe(true);
    expect(validateNif("pt 123 456 789")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(validateNif("")).toBe(false);
    expect(validateNif("12345678")).toBe(false); // 8 digits
    expect(validateNif("1234567890")).toBe(false); // 10 digits
    expect(validateNif("12345678a")).toBe(false); // letter
    expect(validateNif("-12345678")).toBe(false);
    // Passes mod-11 (check digit 7 for 02345678) but no NIF starts with 0.
    expect(expectedCheckDigit("02345678")).toBe(7);
    expect(validateNif("023456787")).toBe(false);
  });
});

describe("MockInvoicingProvider.issueReceipt", () => {
  const baseInput: InvoiceInput = {
    requestId: "req_0001",
    guestId: "guest_0001",
    amountCents: 1250,
    vatRate: 23,
    description: "Pedido de música — sessão de teste",
  };

  it("issues a receipt with a mock_inv_<uuid> ref and records it", async () => {
    const provider = new MockInvoicingProvider();
    const result = await provider.issueReceipt(baseInput);
    expect(result.status).toBe("issued");
    expect(result.providerRef).toMatch(
      /^mock_inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.pdfUrl).toBeNull();
    expect(invoiceOutbox).toHaveLength(1);
    expect(invoiceOutbox[0]).toMatchObject({ input: baseInput, result });
    expect(invoiceOutbox[0]?.error).toBeUndefined();
  });

  it("accepts a valid optional NIF and rejects an invalid one", async () => {
    const provider = new MockInvoicingProvider();
    const ok = await provider.issueReceipt({
      ...baseInput,
      requestId: "req_nif_ok",
      nif: "123456789",
    });
    expect(ok.status).toBe("issued");

    const bad = await provider.issueReceipt({
      ...baseInput,
      requestId: "req_nif_bad",
      nif: "123456780",
    });
    expect(bad.status).toBe("failed");
    expect(bad.pdfUrl).toBeNull();
    const entry = invoiceOutbox.find((e) => e.input.requestId === "req_nif_bad");
    expect(entry?.error).toMatch(/nif/i);
  });

  it("treats an empty NIF as 'no NIF given' (optional at checkout)", async () => {
    const result = await new MockInvoicingProvider().issueReceipt({
      ...baseInput,
      nif: "",
    });
    expect(result.status).toBe("issued");
  });

  it("fails on a non-positive or non-integer amount", async () => {
    const provider = new MockInvoicingProvider();
    for (const amountCents of [0, -100, 12.5]) {
      const result = await provider.issueReceipt({
        ...baseInput,
        requestId: `req_amount_${amountCents}`,
        amountCents,
      });
      expect(result.status).toBe("failed");
    }
  });

  it("is idempotent per requestId: duplicate calls return the original receipt", async () => {
    const provider = new MockInvoicingProvider();
    const first = await provider.issueReceipt(baseInput);
    const second = await provider.issueReceipt(baseInput);
    expect(second).toEqual(first);
    expect(invoiceOutbox).toHaveLength(1);
  });

  it("allows retrying after a failed attempt", async () => {
    const provider = new MockInvoicingProvider();
    const failed = await provider.issueReceipt({ ...baseInput, nif: "111111112" });
    expect(failed.status).toBe("failed");
    const retried = await provider.issueReceipt(baseInput);
    expect(retried.status).toBe("issued");
    expect(retried.providerRef).not.toBe(failed.providerRef);
    expect(invoiceOutbox).toHaveLength(2);
  });
});

describe("getInvoicingProvider", () => {
  it("returns the mock singleton (lazy env import)", async () => {
    const provider = await getInvoicingProvider();
    expect(provider).toBeInstanceOf(MockInvoicingProvider);
    expect(await getInvoicingProvider()).toBe(provider);
  });
});
