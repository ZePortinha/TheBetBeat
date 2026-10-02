import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { recordWebhook } from "@/lib/payments/service";
import { correlationId } from "../../guest/_lib/http";

export const dynamic = "force-dynamic";

/**
 * PSP webhook endpoint (BRIEF B4.3 "Robustez").
 *
 * Raw body + `x-webhook-signature` header → provider.verifyWebhook
 * (constant-time HMAC + strict zod parse). Invalid signature → 401.
 * Valid deliveries ALWAYS get 200 { received: true } — duplicates are
 * no-ops inside `recordWebhook` (payment-status guards + refund
 * idempotency keys), so the PSP never retries forever.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature") ?? "";

  const provider = await getPaymentProvider();
  const event = await provider.verifyWebhook(rawBody, signature);
  if (!event) {
    const id = correlationId();
    console.error(`[webhook:payments] ${id} invalid signature or payload`);
    return NextResponse.json(
      { error: { code: "invalid_signature", id } },
      { status: 401 },
    );
  }

  await recordWebhook(event, Date.now());
  return NextResponse.json({ received: true });
}
