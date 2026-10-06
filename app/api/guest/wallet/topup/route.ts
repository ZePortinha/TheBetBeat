import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { startWalletTopUp } from "@/lib/auction/service";
import { availablePaymentMethods } from "@/lib/payments";
import { encrypt, hashPhone } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { apiError, clientIp, rateLimitedResponse } from "../../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

/** Loadable amounts, cents (the UI offers 10 / 20 / 50 / 100 €). */
const MIN_CENTS = 500;
const MAX_CENTS = 20_000;

const bodySchema = z
  .object({
    token: z.string().min(1).max(1024),
    amountCents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
    method: z.enum(["mbway", "card", "apple_pay", "google_pay"]),
    phone: z.string().regex(/^\+3519\d{8}$/).optional(),
    email: z.string().email().max(254).optional(),
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

/**
 * POST /api/guest/wallet/topup — "Carregar saldo": money into the guest's
 * balance for tonight's bids (MB WAY push or card at once). What is not
 * spent goes back at the end of the night. Anti-bot on money (B12.4).
 */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`topup:${identity.guestId}`, LIMITS.payment.limit, LIMITS.payment.windowMs).ok) {
    return rateLimitedResponse();
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;

  const resolved = await resolveGuestContext(body.token);
  if (!resolved.ok) return apiError("invalid_token", 404);
  if (resolved.ctx.status !== "live") return apiError("session_not_live", 409);
  if (!(await availablePaymentMethods()).includes(body.method)) return apiError("invalid_request", 400);
  if (body.method === "mbway" && !body.phone) return apiError("phone_required", 422);
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(request)))) return apiError("bot_check_failed", 403);

  await ensureGuestRow(identity.guestId);
  if (body.phone) {
    await getPool().query(
      `update public.guests set phone_encrypted = $2, phone_hash = $3, phone_verified_at = null
        where id = $1 and phone_hash is distinct from $3`,
      [identity.guestId, encrypt(body.phone), hashPhone(body.phone)],
    );
  }
  const started = await startWalletTopUp(
    {
      guestId: identity.guestId,
      sessionId: resolved.ctx.sessionId,
      venueId: resolved.ctx.venueId,
      amountCents: body.amountCents,
      method: body.method,
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.email ? { email: body.email } : {}),
    },
    Date.now(),
  );
  return NextResponse.json(
    { state: started.state, intentId: started.intentId, expiresAt: started.expiresAt },
    { status: started.state === "failed" ? 402 : 200 },
  );
}
