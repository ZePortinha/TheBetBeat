import "server-only";
import { z } from "zod";

/**
 * Server environment — validated at boot (B12.1).
 * The app refuses to start if any required variable is missing or malformed.
 * Secret keys live ONLY here; client code imports lib/security/public-env.ts.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(10),
  QR_TOKEN_SECRET: z.string().min(32, "QR_TOKEN_SECRET must be at least 32 chars"),
  DATA_ENCRYPTION_KEY: z
    .string()
    .min(16)
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "DATA_ENCRYPTION_KEY must be base64 for exactly 32 bytes"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  SMS_PROVIDER: z.enum(["mock"]).default("mock"),
  EMAIL_PROVIDER: z.enum(["mock"]).default("mock"),
  INVOICING_PROVIDER: z.enum(["mock"]).default("mock"),
  CATALOG_PROVIDER: z.enum(["mock"]).default("mock"),
  SENTRY_DSN: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional().or(z.literal("")),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional().or(z.literal("")),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

function loadEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[env] Invalid or missing environment variables:\n${missing}\n` +
        `See .env.example for the full list.`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();
export type ServerEnv = typeof env;
