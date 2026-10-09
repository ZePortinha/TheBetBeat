/**
 * Durable rate limit (migration 0015) on the real Postgres:
 *
 *   SUPABASE_TEST=1 pnpm exec vitest run tests/integration/rate-limit-durable.integration.test.ts
 *
 * Parallel calls (as from several app instances) share one count.
 */
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("server-only", () => ({}));
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "local-anon-key-placeholder";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "local-service-key-placeholder";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.QR_TOKEN_SECRET ??= "integration-test-qr-secret-0123456789abcdef";
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??= "test-site-key";
process.env.TURNSTILE_SECRET_KEY ??= "test-secret-key";
process.env.PAYMENT_WEBHOOK_SECRET ??= "integration-webhook-secret";

const { rateLimitDurable } = await import("@/lib/security/rate-limit-pg");

describe("rateLimitDurable (Postgres)", () => {
  it("lets exactly `limit` parallel calls through per window", async () => {
    const key = `test:${randomUUID()}`;
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => rateLimitDurable(key, 10, 60_000, now)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.find((r) => !r.ok)?.retryAfterSec).toBeGreaterThan(0);
  });

  it("starts a fresh count in the next window", async () => {
    const key = `test:${randomUUID()}`;
    const t0 = Math.floor(Date.now() / 60_000) * 60_000;
    expect((await rateLimitDurable(key, 1, 60_000, t0)).ok).toBe(true);
    expect((await rateLimitDurable(key, 1, 60_000, t0 + 1_000)).ok).toBe(false);
    expect((await rateLimitDurable(key, 1, 60_000, t0 + 60_000)).ok).toBe(true);
  });
});
