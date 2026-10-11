/**
 * Client-safe environment. Only NEXT_PUBLIC_* values — inlined at build time.
 * Anything secret belongs in lib/security/env.ts (server-only).
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  /** "1" when Supabase Auth has CAPTCHA (Turnstile) on: sign-ins carry a token. */
  supabaseCaptcha: process.env.NEXT_PUBLIC_SUPABASE_CAPTCHA === "1",
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "",
} as const;
