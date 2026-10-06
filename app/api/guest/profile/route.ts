import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { handleTaken, linkPhoneHandle } from "@/lib/guests/phone-handle";

export const dynamic = "force-dynamic";

/**
 * Opt-in profile bits (B6.8): @handle + ranking opt-in, nothing else.
 * Strict schema — the client can never touch encrypted columns here.
 */
const bodySchema = z
  .object({
    handle: z
      .string()
      .min(2)
      .max(24)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i)
      .optional(),
    rankingOptin: z.boolean().optional(),
    locale: z.enum(["pt-PT", "en"]).optional(),
  })
  .strict();

/** GET /api/guest/profile — the guest's own @ (null until they choose one). */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  const res = await getPool().query<{ handle: string | null }>(`select handle from public.guests where id = $1`, [
    identity.guestId,
  ]);
  return NextResponse.json({ handle: res.rows[0]?.handle ?? null });
}

export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `profile:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);

  await ensureGuestRow(identity.guestId, parsed.data.locale);
  const me = await getPool().query<{ phone_hash: string | null; phone_verified_at: Date | null }>(
    `select phone_hash, phone_verified_at from public.guests where id = $1`,
    [identity.guestId],
  );
  const provenHash = me.rows[0]?.phone_verified_at ? me.rows[0].phone_hash : null;
  if (parsed.data.handle && (await handleTaken(getPool(), parsed.data.handle, provenHash))) {
    return apiError("handle_taken", 409);
  }
  await getPool().query(
    `update public.guests
        set handle = coalesce($2, handle),
            ranking_optin = coalesce($3, ranking_optin),
            locale = coalesce($4, locale)
      where id = $1`,
    [
      identity.guestId,
      parsed.data.handle ?? null,
      parsed.data.rankingOptin ?? null,
      parsed.data.locale ?? null,
    ],
  );

  if (parsed.data.handle && provenHash) await linkPhoneHandle(getPool(), identity.guestId, provenHash);
  return NextResponse.json({ ok: true });
}
