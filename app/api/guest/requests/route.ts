import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { toGuestRequestDto, type RequestRow } from "@/lib/domain/dto";
import { createRequestAndStartPayment } from "@/lib/domain/service";
import { validateNif } from "@/lib/invoicing";
import { encrypt } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { apiError, clientIp, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * Strict allowlist (B12.2): the client sends the quoteId and its CHOICE —
 * never prices. `amountCents` is validated server-side against the quote
 * (price ≤ amount ≤ tier max) inside the domain service.
 */
const createSchema = z
  .object({
    quoteId: z.string().uuid(),
    tier: z.enum(["QUEUE", "SOON", "NEXT"]),
    amountCents: z.number().int().positive().max(100_000),
    method: z.enum(["mbway", "card", "apple_pay", "google_pay"]),
    phone: z
      .string()
      .regex(/^\+3519\d{8}$/)
      .optional(),
    email: z.string().email().max(254).optional(),
    nif: z.string().max(20).optional(),
    message: z.string().max(60).optional(),
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

/** POST /api/guest/requests — reserve the slot + start the payment (B4.3). */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `payment:${identity.guestId}`,
    LIMITS.payment.limit,
    LIMITS.payment.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;

  // Anti-bot on payment start (B12.4).
  const human = await verifyTurnstile(body.turnstileToken, clientIp(request));
  if (!human) return apiError("bot_check_failed", 403);

  // Optional NIF for the invoice-receipt (B4.5): validated inline; the
  // mock invoicing provider does not persist it yet (Phase 8 wires the
  // certified provider), so an invalid NIF is the only hard failure.
  if (body.nif !== undefined && body.nif !== "" && !validateNif(body.nif)) {
    return apiError("nif_invalid", 422);
  }

  await ensureGuestRow(identity.guestId);

  const outcome = await createRequestAndStartPayment(
    {
      quoteId: body.quoteId,
      guestId: identity.guestId,
      tier: body.tier,
      amountCents: body.amountCents,
      method: body.method,
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.message !== undefined ? { message: body.message } : {}),
    },
    Date.now(),
  );
  if (!outcome.ok) {
    return apiError(outcome.error, 409);
  }

  // Optional email for the receipt: encrypted at rest (B12.5).
  if (body.email) {
    await getPool().query(
      `update public.guests set email_encrypted = $2 where id = $1`,
      [identity.guestId, encrypt(body.email)],
    );
  }

  return NextResponse.json(
    {
      requestId: outcome.requestId,
      status: outcome.status,
      payment: {
        paymentId: outcome.payment.paymentId,
        method: body.method,
        status: outcome.payment.status,
        expiresAt: outcome.payment.expiresAt,
      },
    },
    { status: 201 },
  );
}

/** GET /api/guest/requests — the guest's own history (B6.9), minimal DTO. */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `requests-list:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const res = await getPool().query<RequestRow & { invoice_ref: string | null }>(
    `select r.*, i.provider_ref as invoice_ref
       from public.requests r
       left join public.invoices i on i.request_id = r.id
      where r.guest_id = $1
      order by r.created_at desc
      limit 50`,
    [identity.guestId],
  );

  return NextResponse.json({
    requests: res.rows.map((row) => ({
      ...toGuestRequestDto(row),
      sessionId: row.session_id,
      invoiceRef: row.invoice_ref,
    })),
  });
}
