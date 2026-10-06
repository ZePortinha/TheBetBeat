/**
 * Worker configuration (BRIEF B11 "Worker Node com pg-boss").
 *
 * Every interval and cron is configurable via OPTIONAL env vars with safe
 * defaults, validated with zod at boot (B12.1 applies to the worker too:
 * an invalid value fails loudly instead of running with garbage). The
 * required server secrets stay in lib/security/env.ts — this module only
 * owns the worker's own knobs.
 */

import { z } from "zod";

/** Five-field cron expression (pg-boss cron is minute precision). */
const cron = z
  .string()
  .regex(/^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/, "must be a 5-field cron expression");

const workerEnvSchema = z.object({
  /** Fast deadline loop period — second-precision promises (B4.1/B4.2). */
  // 1 s: slot auctions close on the server clock (soft close is 30 s).
  WORKER_DEADLINE_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  /** Max rows claimed per scan query. */
  WORKER_SCAN_BATCH: z.coerce.number().int().min(1).max(500).default(100),
  /** Auto-close grace after sessions.ends_at, minutes (B4.2 — default 30). */
  WORKER_SESSION_GRACE_MIN: z.coerce.number().int().min(0).max(24 * 60).default(30),
  /** Watchdog cron re-running the deadline scan if the loop ever dies. */
  WORKER_WATCHDOG_CRON: cron.default("* * * * *"),

  /** Sweep cron that re-enqueues stuck refunds (B4.4 retry + alert). */
  WORKER_REFUND_SCAN_CRON: cron.default("* * * * *"),
  /** How long a refund may sit in processing before it counts as stuck. */
  WORKER_REFUND_STUCK_SEC: z.coerce.number().int().min(10).default(60),
  /** Total provider attempts before the admin alert (B4.4 — default 5). */
  WORKER_REFUND_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /** Base retry delay, seconds — pg-boss doubles it per retry (backoff). */
  WORKER_REFUND_RETRY_DELAY_SEC: z.coerce.number().int().min(1).default(60),

  /** Daily reconciliation report (B4.3 "reconciliação diária"). */
  WORKER_RECONCILIATION_CRON: cron.default("0 5 * * *"),

  /** Weekly genre multiplier recommendation (B5.4). */
  WORKER_GENRE_CRON: cron.default("0 6 * * 1"),
  WORKER_GENRE_MIN_QUOTES: z.coerce.number().int().min(1).default(30),
  WORKER_GENRE_WINDOW_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Sweep cron that enqueues pending payouts of ended sessions (B4.5). */
  WORKER_PAYOUT_SCAN_CRON: cron.default("*/2 * * * *"),
  /** Daily: wallet balances unused for the club's keepBalanceDays go back. */
  WORKER_WALLET_EXPIRY_CRON: cron.default("30 5 * * *"),

  /** Timezone for the pg-boss schedules. Storage stays UTC (B11). */
  WORKER_CRON_TZ: z.string().min(1).default("UTC"),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[worker] Invalid worker environment variables:\n${issues}`);
  }
  return parsed.data;
}
