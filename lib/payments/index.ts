/**
 * Payment provider factory (BRIEF B4.3). Everything outside lib/payments
 * talks to `PaymentProvider` only — Phase 8 adds a real PSP adapter here
 * without touching callers.
 *
 * `env` is imported lazily INSIDE the factory so pure unit tests can import
 * mock/webhooks without a configured environment (lib/security/env.ts is
 * server-only and validates at load).
 */
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
    // Phase 8: register the real PSP adapter here (MB WAY, cards, wallets,
    // marketplace split/payouts) behind the same PaymentProvider surface.
    default: {
      const exhausted: never = env.PAYMENT_PROVIDER;
      throw new Error(`Unknown PAYMENT_PROVIDER: ${String(exhausted)}`);
    }
  }
}
