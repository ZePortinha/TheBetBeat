import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { isPushEndpoint } from "@/lib/notifications/push";
import { env } from "@/lib/security/env";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { resolveGuestContext } from "../_lib/context";

export const dynamic = "force-dynamic";

/** Devices per guest; the oldest goes first. */
const MAX_DEVICES = 5;

const subscribeSchema = z
  .object({
    token: z.string().min(1).max(1024),
    endpoint: z.string().url().max(1024).refine(isPushEndpoint),
    keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }).strict(),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().max(1024) }).strict();

/** GET /api/guest/push — the VAPID public key, or null while push is off. */
export function GET() {
  return NextResponse.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
}

/** POST /api/guest/push — this device gets the outbid / winner notices. */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`push:${identity.guestId}`, 10, 60_000).ok) return rateLimitedResponse();
  if (!env.VAPID_PUBLIC_KEY) return apiError("not_found", 404);
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = subscribeSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  const body = parsed.data;
  const resolved = await resolveGuestContext(body.token);
  if (!resolved.ok) return apiError("invalid_token", 404);

  await ensureGuestRow(identity.guestId);
  const pool = getPool();
  await pool.query(
    `insert into public.push_subscriptions (guest_id, endpoint, p256dh, auth, url_path)
     values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
       set guest_id = excluded.guest_id, p256dh = excluded.p256dh, auth = excluded.auth,
           url_path = excluded.url_path, created_at = now()`,
    [identity.guestId, body.endpoint, body.keys.p256dh, body.keys.auth, `/s/${body.token}`],
  );
  await pool.query(
    `delete from public.push_subscriptions
      where guest_id = $1
        and id not in (select id from public.push_subscriptions where guest_id = $1 order by created_at desc limit $2)`,
    [identity.guestId, MAX_DEVICES],
  );
  return NextResponse.json({ ok: true });
}

/** DELETE /api/guest/push — stop the notices on this device. */
export async function DELETE(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = unsubscribeSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  await getPool().query(`delete from public.push_subscriptions where guest_id = $1 and endpoint = $2`, [
    identity.guestId,
    parsed.data.endpoint,
  ]);
  return NextResponse.json({ ok: true });
}
