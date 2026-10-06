import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { placeBid, startTopUpBid, type BidRequest } from "@/lib/auction/service";
import type { DisplayChoice } from "@/lib/auction/recognition";
import { encrypt, hashPhone } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { apiError, clientIp, rateLimitedResponse } from "../../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

/**
 * POST /api/guest/auction/bid — one bid action (new, raise, or back
 * someone else's bid). The client sends the bid's new TOTAL, never what
 * to pay: the server takes it from the wallet and charges only the rest.
 * Without enough balance and without a payment method → 402 with
 * `needCents`, so the app asks how to pay.
 */
const bodySchema = z
  .object({
    token: z.string().min(1).max(1024),
    slotId: z.string().uuid(),
    totalCents: z.number().int().positive().max(10_000_000),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("own"), trackId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal("back"), bidId: z.string().uuid() }).strict(),
    ]),
    display: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("anonymous") }).strict(),
      z.object({ mode: z.literal("handle"), handle: z.string().regex(/^@?[a-z0-9][a-z0-9._-]{1,23}$/i) }).strict(),
      z.object({ mode: z.literal("table"), table: z.string().trim().min(1).max(20) }).strict(),
    ]),
    method: z.enum(["mbway", "card", "apple_pay", "google_pay"]).optional(),
    phone: z.string().regex(/^\+3519\d{8}$/).optional(),
    email: z.string().email().max(254).optional(),
    turnstileToken: z.string().min(1).max(4096).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`bid:${identity.guestId}`, LIMITS.payment.limit * 2, LIMITS.payment.windowMs).ok) {
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
  const slotRes = await getPool().query(`select 1 from public.auction_slots where id = $1 and session_id = $2`, [
    body.slotId,
    resolved.ctx.sessionId,
  ]);
  if ((slotRes.rowCount ?? 0) === 0) return apiError("slot_not_found", 404);

  await ensureGuestRow(identity.guestId);
  const display: DisplayChoice =
    body.display.mode === "handle"
      ? { mode: "handle", handle: body.display.handle.replace(/^@/, "").toLowerCase() }
      : body.display;
  if (display.mode === "handle") {
    // The @ is the guest's public name: remember it (and their consent).
    await getPool().query(
      `update public.guests set handle = $2, ranking_optin = true where id = $1`,
      [identity.guestId, display.handle],
    );
  }

  const req: BidRequest = {
    slotId: body.slotId,
    guestId: identity.guestId,
    totalCents: body.totalCents,
    target: body.target.kind === "own" ? { kind: "own", libraryTrackId: body.target.trackId } : body.target,
    display,
  };
  const now = Date.now();
  const placed = await placeBid(req, now);
  if (placed.ok) return NextResponse.json({ state: "placed", bid: placed });
  if (placed.error !== "insufficient_funds") return apiError(placed.error, 409);

  // The wallet does not cover it: charge the rest (anti-bot on money, B12.4).
  const needCents = placed.needCents ?? 0;
  if (!body.method) return NextResponse.json({ state: "payment_required", needCents }, { status: 402 });
  if (body.method === "mbway" && !body.phone) return apiError("phone_required", 422);
  const human = await verifyTurnstile(body.turnstileToken ?? "missing", clientIp(request));
  if (!human) return apiError("bot_check_failed", 403);

  if (body.phone) {
    await getPool().query(
      `update public.guests set phone_encrypted = $2, phone_hash = $3, phone_verified_at = null
        where id = $1 and phone_hash is distinct from $3`,
      [identity.guestId, encrypt(body.phone), hashPhone(body.phone)],
    );
  }
  const started = await startTopUpBid(
    {
      ...req,
      needCents,
      method: body.method,
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.email ? { email: body.email } : {}),
    },
    now,
  );
  return NextResponse.json(
    { state: started.state, intentId: started.intentId, expiresAt: started.expiresAt, needCents, bid: started.bid ?? null },
    { status: started.state === "failed" ? 402 : 200 },
  );
}
