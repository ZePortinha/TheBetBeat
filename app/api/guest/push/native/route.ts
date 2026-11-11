import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { isNativeDeviceToken, nativePushEnabled } from "@/lib/notifications/native-push";
import { env } from "@/lib/security/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

/** Devices per guest; the oldest goes first (same cap as web push). */
const MAX_DEVICES = 5;

const platformSchema = z.enum(["ios", "android"]);

const registerSchema = z
  .object({
    token: z.string().min(1).max(1024),
    platform: platformSchema,
    deviceToken: z.string().min(32).max(4096),
  })
  .strict()
  .refine((b) => isNativeDeviceToken(b.platform, b.deviceToken));

const unregisterSchema = z.object({ deviceToken: z.string().max(4096) }).strict();

/** GET /api/guest/push/native — which platforms the server can reach (the app hides its prompt otherwise). */
export function GET() {
  return NextResponse.json(nativePushEnabled(env));
}

/** POST /api/guest/push/native — this phone (App Store / Play build) gets the outbid / winner notices. */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`push:${identity.guestId}`, 10, 60_000).ok) return rateLimitedResponse();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = registerSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;
  if (!nativePushEnabled(env)[body.platform]) return apiError("not_found", 404);
  const resolved = await resolveGuestContext(body.token);
  if (!resolved.ok) return apiError("invalid_token", 404);

  await ensureGuestRow(identity.guestId);
  const pool = getPool();
  await pool.query(
    `insert into public.native_push_tokens (guest_id, platform, token, url_path)
     values ($1, $2, $3, $4)
     on conflict (token) do update
       set guest_id = excluded.guest_id, platform = excluded.platform,
           url_path = excluded.url_path, created_at = now()`,
    [identity.guestId, body.platform, body.deviceToken, `/s/${body.token}`],
  );
  await pool.query(
    `delete from public.native_push_tokens
      where guest_id = $1
        and id not in (select id from public.native_push_tokens where guest_id = $1 order by created_at desc limit $2)`,
    [identity.guestId, MAX_DEVICES],
  );
  return NextResponse.json({ ok: true });
}

/** DELETE /api/guest/push/native — stop the notices on this phone. */
export async function DELETE(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = unregisterSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  await getPool().query(`delete from public.native_push_tokens where guest_id = $1 and token = $2`, [
    identity.guestId,
    parsed.data.deviceToken,
  ]);
  return NextResponse.json({ ok: true });
}
