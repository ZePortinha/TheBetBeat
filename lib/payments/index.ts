/**
 * Payment provider factory (BRIEF B4.3). Everything outside lib/payments
 * talks to `PaymentProvider` only — Phase 8 adds a real PSP adapter here
 * without touching callers.
 *
 * `env` is imported lazily INSIDE the factory so pure unit tests can import
 * mock/webhooks without a configured environment (lib/security/env.ts is
 * server-only and validates at load).
 */
import type { PaymentMethod } from "@/lib/domain/types";
import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";

export type {
  AuthorizeInput,
  PaymentIntentResult,
  PaymentProvider,
  WebhookEvent,
} from "./types";
export {
  MockPaymentProvider,
  MBWAY_DEFAULT_TIMEOUT_MS,
  MOCK_MBWAY_FAIL_PHONE,
  MOCK_MBWAY_NEVER_CONFIRM_PHONE,
} from "./mock";
export { buildMockWebhook, signWebhookBody, verifySignedWebhook } from "./webhooks";

let cached: PaymentProvider | null = null;

/** Process-wide singleton so the mock's intent Map survives across routes. */
export async function getPaymentProvider(): Promise<PaymentProvider> {
  if (cached) return cached;

  const { env } = await import("@/lib/security/env");
  switch (env.PAYMENT_PROVIDER) {
    case "mock": {
      cached = new MockPaymentProvider({
        webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
      });
      return cached;
    }
    // Real MB WAY through ifthenpay. Cards/wallets stay on the mock in
    // development and are unavailable in production until a card gateway.
    case "ifthenpay": {
      const { IfthenpayProvider } = await import("./ifthenpay");
      cached = new IfthenpayProvider({
        mbWayKey: env.IFTHENPAY_MBWAY_KEY!,
        backofficeKey: env.IFTHENPAY_BACKOFFICE_KEY!,
        fallback:
          env.NODE_ENV === "production" ? null : new MockPaymentProvider({ webhookSecret: env.PAYMENT_WEBHOOK_SECRET }),
      });
      return cached;
    }
    default: {
      const exhausted: never = env.PAYMENT_PROVIDER;
      throw new Error(`Unknown PAYMENT_PROVIDER: ${String(exhausted)}`);
    }
  }
}

/** Methods guests can pay with right now (the bid form shows only these). */
export async function availablePaymentMethods(): Promise<PaymentMethod[]> {
  const { env } = await import("@/lib/security/env");
  if (env.PAYMENT_PROVIDER === "ifthenpay" && env.NODE_ENV === "production") return ["mbway"];
  return ["mbway", "card", "apple_pay", "google_pay"];
}
