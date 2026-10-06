"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";
import { clientIpFrom } from "@/lib/security/client-ip";
import { safeNextPath } from "@/lib/security/redirect";
import { rateLimit, LIMITS } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { publicEnv } from "@/lib/security/public-env";

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  next: z.unknown().transform((v) => safeNextPath(v, "/cockpit")),
  turnstileToken: z.string().max(4096).optional(),
});

export type LoginState = { error?: "invalid" | "rate_limited" | "bot" } | null;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? "/cockpit",
    turnstileToken: formData.get("cf-turnstile-response") ?? undefined,
  });
  if (!parsed.success) return { error: "invalid" };

  const ip = clientIpFrom(await headers());
  // Per IP, and per account so a botnet cannot spray one staff password.
  const account = createHash("sha256").update(parsed.data.email.toLowerCase()).digest("hex").slice(0, 32);
  const limited = [
    rateLimit(`login:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs),
    rateLimit(`login-account:${account}`, LIMITS.login.limit, LIMITS.login.windowMs),
  ].some((r) => !r.ok);
  if (limited) return { error: "rate_limited" };

  // The form renders the widget; production refuses a sign-in without it.
  // With Supabase CAPTCHA on, Auth verifies the (single-use) token itself.
  const token = parsed.data.turnstileToken;
  const authCaptcha = publicEnv.supabaseCaptcha;
  if (!authCaptcha && (token || process.env.NODE_ENV === "production")) {
    const human = await verifyTurnstile(token ?? "", ip);
    if (!human) return { error: "bot" };
  }
  if (authCaptcha && !token) return { error: "bot" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    ...(authCaptcha ? { options: { captchaToken: token } } : {}),
  });
  if (error) return { error: error.code === "captcha_failed" ? "bot" : "invalid" };

  redirect(parsed.data.next);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
