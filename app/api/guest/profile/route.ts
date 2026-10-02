import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";

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

  return NextResponse.json({ ok: true });
}
