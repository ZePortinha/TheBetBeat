/**
 * Invoicing (B4.5): provider factory. The env is imported LAZILY so pure code
 * (and tests) can import this module without a configured server environment.
 * Only the mock exists until Phase 8 wires an AT-certified provider.
 */
import type { InvoicingProvider } from "@/lib/invoicing/types";

export { validateNif } from "@/lib/invoicing/mock";

let singleton: InvoicingProvider | undefined;

async function instantiate(kind: "mock"): Promise<InvoicingProvider> {
  switch (kind) {
    case "mock": {
      const { MockInvoicingProvider } = await import("@/lib/invoicing/mock");
      return new MockInvoicingProvider();
    }
  }
}

export async function getInvoicingProvider(): Promise<InvoicingProvider> {
  if (!singleton) {
    const { env } = await import("@/lib/security/env");
    singleton = await instantiate(env.INVOICING_PROVIDER);
  }
  return singleton;
}
