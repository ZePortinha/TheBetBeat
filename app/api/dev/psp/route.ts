import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getPaymentProvider, MockPaymentProvider } from "@/lib/payments";
import type { WebhookEvent } from "@/lib/payments/types";
import { apiError } from "../../guest/_lib/http";
import { getGuestIdentity } from "../../guest/_lib/auth";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY PSP simulator (BRIEF B4.3 "painel de desenvolvimento").
 *
 * Returns 404 in production. Actions mutate the mock PSP's state and
 * deliver the resulting SIGNED webhook to the app's real webhook route
 * (`/api/webhooks/payments`) over HTTP, so the exact production path —
 * signature check, dedupe, transition, broadcast — is exercised:
 *
 *   confirm      guest approved the MB WAY push  → payment.confirmed
 *   decline      guest declined the push         → payment.failed
 *   expire       the push timed out              → payment.expired
 *   duplicate    confirm delivered TWICE (second must be a no-op)
 *   network_fail a delivery with a corrupted signature (401; nothing
 *                changes — the payment stays pending and can still be
 *                confirmed later)
 */

function notFound() {
  return NextResponse.json({ error: { code: "not_found", id: "dev" } }, { status: 404 });
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

async function deliver(rawBody: string, signature: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${base.replace(/\/$/, "")}/api/webhooks/payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signature,
    },
    body: rawBody,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** GET — the signed-in guest's recent payments, for the DEV panel list. */
export async function GET(request: Request) {
  if (isProduction()) return notFound();

  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const res = await getPool().query<{
    id: string;
    request_id: string;
    provider_ref: string | null;
    method: string;
    status: string;
    amount_cents: number;
    expires_at: Date | null;
    created_at: Date;
    track_title: string;
  }>(
    // Auction top-ups have no request: they show as a wallet top-up.
    `select p.id, p.request_id, p.provider_ref, p.method, p.status,
            p.amount_cents, p.expires_at, p.created_at,
            coalesce(r.track_title, 'Saldo para licitação') as track_title
       from public.payments p
       left join public.requests r on r.id = p.request_id
      where p.guest_id = $1
      order by p.created_at desc
      limit 10`,
    [identity.guestId],
  );

  return NextResponse.json({
    payments: res.rows.map((p) => ({
      paymentId: p.id,
      requestId: p.request_id,
      providerRef: p.provider_ref,
      method: p.method,
      status: p.status,
      amountCents: p.amount_cents,
      expiresAt: p.expires_at ? p.expires_at.toISOString() : null,
      trackTitle: p.track_title,
    })),
  });
}

const bodySchema = z
  .object({
    paymentId: z.string().uuid().optional(),
    providerRef: z.string().min(1).max(200).optional(),
    action: z.enum(["confirm", "decline", "expire", "duplicate", "network_fail"]),
  })
  .strict()
  .refine((b) => b.paymentId !== undefined || b.providerRef !== undefined, {
    message: "paymentId or providerRef required",
  });

export async function POST(request: Request) {
  if (isProduction()) return notFound();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);

  let providerRef = parsed.data.providerRef ?? null;
  if (!providerRef && parsed.data.paymentId) {
    const res = await getPool().query<{ provider_ref: string | null }>(
      `select provider_ref from public.payments where id = $1`,
      [parsed.data.paymentId],
    );
    providerRef = res.rows[0]?.provider_ref ?? null;
  }
  if (!providerRef) return apiError("payment_not_found", 404);

  // A capability check, not instanceof: dev hot reload can load the mock
  // class twice, and the shared provider may come from the other copy.
  const candidate = await getPaymentProvider();
  if (!("simulateMbwayConfirmation" in candidate)) {
    return apiError("not_mock_provider", 409);
  }
  const provider = candidate as MockPaymentProvider;

  const deliveries: Array<{ status: number; body: unknown }> = [];
  try {
    switch (parsed.data.action) {
      case "confirm": {
        const event = provider.simulateMbwayConfirmation(providerRef);
        const { rawBody, signature } = provider.buildWebhook(event);
        deliveries.push(await deliver(rawBody, signature));
        break;
      }
      case "decline": {
        const event = provider.simulateMbwayDecline(providerRef);
        const { rawBody, signature } = provider.buildWebhook(event);
        deliveries.push(await deliver(rawBody, signature));
        break;
      }
      case "expire": {
        const event = provider.simulateMbwayExpiry(providerRef);
        const { rawBody, signature } = provider.buildWebhook(event);
        deliveries.push(await deliver(rawBody, signature));
        break;
      }
      case "duplicate": {
        // Same event delivered twice: the second MUST be a no-op (B4.3).
        const event = provider.simulateMbwayConfirmation(providerRef);
        const { rawBody, signature } = provider.buildWebhook(event);
        deliveries.push(await deliver(rawBody, signature));
        deliveries.push(await deliver(rawBody, signature));
        break;
      }
      case "network_fail": {
        // Corrupted delivery: valid-looking body, wrong signature → the
        // webhook route answers 401 and NOTHING changes (the PSP would
        // retry; here the guest can still confirm afterwards).
        const fake: WebhookEvent = {
          id: `evt_${providerRef}_network_fail`,
          providerRef,
          type: "payment.confirmed",
          raw: { mock: true, simulated: "network_fail" },
        };
        const rawBody = JSON.stringify(fake);
        const badSignature = createHmac("sha256", "wrong-secret-for-simulated-drop")
          .update(rawBody, "utf8")
          .digest("hex");
        deliveries.push(await deliver(rawBody, badSignature));
        break;
      }
    }
  } catch (error) {
    return apiError(
      "simulation_failed",
      409,
      error instanceof Error ? error.message : "unknown",
    );
  }

  return NextResponse.json({ action: parsed.data.action, deliveries });
}
