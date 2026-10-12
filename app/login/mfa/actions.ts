"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/security/env";
import { clientIpFrom } from "@/lib/security/client-ip";
import { rateLimit, LIMITS } from "@/lib/security/rate-limit";
import {
  DEV_MFA_COOKIE,
  DEV_MFA_MAX_AGE_S,
  isDevMfaCode,
  signDevMfa,
} from "@/lib/security/dev-mfa";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/**
 * Development-only: accepts the test code (DEV_MFA_CODE, default 000000) as
 * the second factor for the signed-in staff user. Always false in production.
 */
export async function devMfaAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !isDevMfaCode(parsed.data.code)) return { ok: false };

  const ip = clientIpFrom(await headers());
  if (!rateLimit(`dev-mfa:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs).ok) {
    return { ok: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return { ok: false };

  (await cookies()).set(DEV_MFA_COOKIE, signDevMfa(user.id, env.QR_TOKEN_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    path: "/",
    maxAge: DEV_MFA_MAX_AGE_S,
  });
  return { ok: true };
}
