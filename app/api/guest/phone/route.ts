import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { buildLoginCodeMessage, getSmsProvider } from "@/lib/notifications";
import { decrypt, encrypt, hashPhone, hashSmsCode } from "@/lib/security/crypto";
import { checkSmsCode, newSmsCode, SMS_CODE_TTL_MS, SMS_CODES_PER_DAY, SMS_CODES_PER_HOUR } from "@/lib/security/otp";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { linkPhoneHandle } from "@/lib/guests/phone-handle";
import { apiError, clientIp, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { guestListPartyHref } from "../_lib/guest-list";

export const dynamic = "force-dynamic";

/**
 * Guest phone sign-in (2026-10-05). Optional: never required to pay
 * (B1/B4 #3). The verified number is kept encrypted (B12.5) and pre-fills
 * MB WAY. `partyHref` is the live party whose guest list holds the number
 * (only ever revealed after the SMS code proved the number).
 *
 *   GET                       the saved number (own row only) + partyHref
 *   POST { phone, turnstile } sends a 6-digit code by SMS
 *   POST { phone, code }      verifies it, saves the number, + partyHref
 *   DELETE                    forgets the number; phone_hash stays for the
 *                             night limits (B4.7)
 */

const bodySchema = z
  .object({
    phone: z.string().regex(/^\+3519\d{8}$/),
    code: z.string().regex(/^\d{6}$/).optional(),
    turnstileToken: z.string().min(1).max(4096).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`phone:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }

  const res = await getPool().query<{
    phone_encrypted: string | null;
    phone_hash: string | null;
    phone_verified_at: Date | null;
  }>(`select phone_encrypted, phone_hash, phone_verified_at from public.guests where id = $1`, [
    identity.guestId,
  ]);
  const row = res.rows[0];
  let phone: string | null = null;
  try {
    phone = row?.phone_encrypted ? decrypt(row.phone_encrypted) : null;
  } catch {
    // Unreadable after a key rotation: behave as if nothing was saved.
  }
  const verified = phone !== null && Boolean(row?.phone_verified_at);
  const partyHref = verified && row?.phone_hash ? await guestListPartyHref(row.phone_hash) : null;
  return NextResponse.json({ phone, verified, partyHref });
}

export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);

  const { guestId } = identity;
  const { phone, code } = parsed.data;
  const phoneHash = hashPhone(phone);
  const pool = getPool();

  // ── Verify ───────────────────────────────────────────────────────
  if (code !== undefined) {
    if (!rateLimit(`sms-verify:${guestId}`, LIMITS.smsVerify.limit, LIMITS.smsVerify.windowMs).ok) {
      return rateLimitedResponse();
    }
    const res = await pool.query<{
      id: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `select id, code_hash, attempts, expires_at, consumed_at
         from public.guest_phone_codes
        where guest_id = $1 and phone_hash = $2
        order by created_at desc
        limit 1`,
      [guestId, phoneHash],
    );
    const row = res.rows[0];
    if (!row) return apiError("code_expired", 422);

    const check = checkSmsCode(
      {
        codeHash: row.code_hash,
        attempts: row.attempts,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      },
      hashSmsCode(code, guestId, phoneHash),
      Date.now(),
    );
    if (check === "mismatch") {
      await pool.query(
        `update public.guest_phone_codes set attempts = attempts + 1 where id = $1`,
        [row.id],
      );
      return apiError("code_invalid", 422);
    }
    if (check !== "ok") {
      return apiError(check === "expired" ? "code_expired" : "code_attempts", 422);
    }

    // Exactly once: a code racing itself verifies a single time.
    const used = await pool.query(
      `update public.guest_phone_codes set consumed_at = now()
        where id = $1 and consumed_at is null`,
      [row.id],
    );
    if (used.rowCount === 0) return apiError("code_expired", 422);

    await pool.query(
      `update public.guests
          set phone_encrypted = $2, phone_hash = $3, phone_verified_at = now()
        where id = $1`,
      [guestId, encrypt(phone), phoneHash],
    );
    await pool.query(
      `insert into public.audit_log (actor, action, entity, entity_id)
       values ($1, 'guest.phone_verified', 'guest', $2)`,
      [`guest:${guestId}`, guestId],
    );
    // The number owns one @: this device gets it back (or the number keeps this one).
    await linkPhoneHandle(pool, guestId, phoneHash);
    return NextResponse.json({
      phone,
      verified: true,
      partyHref: await guestListPartyHref(phoneHash),
    });
  }

  // ── Send ─────────────────────────────────────────────────────────
  // Per guest, per number (no SMS bombing a stranger) and per IP.
  const limited = [
    rateLimit(`sms:${guestId}`, LIMITS.smsCode.limit, LIMITS.smsCode.windowMs),
    rateLimit(`sms:${phoneHash}`, LIMITS.smsCode.limit, LIMITS.smsCode.windowMs),
    rateLimit(`sms-ip:${clientIp(request)}`, LIMITS.smsIp.limit, LIMITS.smsIp.windowMs),
  ].some((r) => !r.ok);
  if (limited) return rateLimitedResponse();

  // Every SMS costs money: anti-bot like a payment start (B12.4).
  const human = await verifyTurnstile(parsed.data.turnstileToken ?? "missing", clientIp(request));
  if (!human) return apiError("bot_check_failed", 403);

  // Durable caps (the in-memory limits above reset on restart and are per
  // instance): a number gets at most 5 codes an hour and 10 a day, so the
  // 5 guesses per code cannot be multiplied into a brute force.
  const recent = await pool.query<{ hour: string; day: string; mine: string }>(
    `select count(*) filter (where created_at > now() - interval '1 hour') as hour,
            count(*) as day,
            count(*) filter (where guest_id = $2) as mine
       from public.guest_phone_codes
      where (phone_hash = $1 or guest_id = $2) and created_at > now() - interval '1 day'`,
    [phoneHash, guestId],
  );
  const counts = recent.rows[0];
  if (counts && (Number(counts.hour) >= SMS_CODES_PER_HOUR || Number(counts.day) >= SMS_CODES_PER_DAY || Number(counts.mine) >= SMS_CODES_PER_DAY)) {
    return rateLimitedResponse();
  }

  await ensureGuestRow(guestId);
  const smsCode = newSmsCode();
  const expiresAt = new Date(Date.now() + SMS_CODE_TTL_MS);
  await pool.query(
    `insert into public.guest_phone_codes (guest_id, phone_hash, code_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [guestId, phoneHash, hashSmsCode(smsCode, guestId, phoneHash), expiresAt],
  );

  const sms = await getSmsProvider();
  const sent = await sms.send(phone, buildLoginCodeMessage(smsCode));
  if (!sent.ok) return apiError("sms_failed", 502);

  return NextResponse.json({
    expiresAt: expiresAt.toISOString(),
    // Mock SMS only, never in production: the code shows on screen so
    // development and E2E can sign in without a phone.
    ...(process.env.NODE_ENV !== "production" && sms.name === "mock-sms"
      ? { devCode: smsCode }
      : {}),
  });
}

export async function DELETE(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const pool = getPool();
  await pool.query(
    `update public.guests set phone_encrypted = null, phone_verified_at = null where id = $1`,
    [identity.guestId],
  );
  await pool.query(
    `insert into public.audit_log (actor, action, entity, entity_id)
     values ($1, 'guest.phone_forgotten', 'guest', $2)`,
    [`guest:${identity.guestId}`, identity.guestId],
  );
  return NextResponse.json({ ok: true });
}
