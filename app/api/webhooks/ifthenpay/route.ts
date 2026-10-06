import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPaymentProvider } from "@/lib/payments";
import { IFTHENPAY_REF_PREFIX } from "@/lib/payments/ifthenpay";
import { recordWebhook } from "@/lib/payments/service";
import { correlationId } from "../../guest/_lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhooks/ifthenpay — ifthenpay's MB WAY payment callback.
 *
 * Configure in ifthenpay (backoffice or /v2/callback/activation) as:
 *   https://<app>/api/webhooks/ifthenpay?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]
 *     &amount=[AMOUNT]&requestId=[REQUEST_ID]&payment_datetime=[PAYMENT_DATETIME]
 *
 * Trust nothing in the URL: the anti-phishing key is compared in constant
 * time, then the payment is re-checked with ifthenpay's status API before
 * it is recorded. Duplicate callbacks are no-ops inside recordWebhook.
 */
const querySchema = z.object({
  key: z.string().min(1).max(256),
  requestId: z.string().regex(/^[A-Za-z0-9]{6,64}$/),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const { env } = await import("@/lib/security/env");
  const id = correlationId();
  if (env.PAYMENT_PROVIDER !== "ifthenpay" || !env.IFTHENPAY_ANTI_PHISHING_KEY) {
    return NextResponse.json({ error: { code: "not_found", id } }, { status: 404 });
  }

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success || !sameKey(parsed.data.key, env.IFTHENPAY_ANTI_PHISHING_KEY)) {
    console.error(`[webhook:ifthenpay] ${id} rejected callback`);
    return NextResponse.json({ error: { code: "invalid_signature", id } }, { status: 401 });
  }

  const providerRef = `${IFTHENPAY_REF_PREFIX}${parsed.data.requestId}`;
  const provider = await getPaymentProvider();
  const status = await provider.getStatus(providerRef);
  if (status.status !== "captured") {
    // Not confirmed by the status API: the poll in the worker settles it.
    console.error(`[webhook:ifthenpay] ${id} callback not confirmed by status API (${status.status})`);
    return NextResponse.json({ received: true });
  }

  await recordWebhook(
    {
      id: `ifthenpay:${parsed.data.requestId}:paid`,
      providerRef,
      type: "payment.confirmed",
      raw: { requestId: parsed.data.requestId, amount: parsed.data.amount },
    },
    Date.now(),
  );
  return NextResponse.json({ received: true });
}
