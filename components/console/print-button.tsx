"use client";

/**
 * Print trigger for the zone QR print page. Decision (vs a PDF lib):
 * the print page is pure @media print CSS — A5 cards, white background,
 * no runtime dependency — and window.print() hands the PDF step to the
 * browser, which every venue laptop already has.
 */

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-500
        px-5 text-base font-semibold text-text-on-accent transition-transform
        duration-100 active:scale-[0.97] print:hidden"
    >
      <Printer aria-hidden size={20} strokeWidth={1.75} />
      {label}
    </button>
  );
}
