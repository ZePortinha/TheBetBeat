/**
 * Worker runtime (BRIEF B11 "Worker Node com pg-boss").
 *
 * Wires pg-boss (schema 'pgboss' on env.DATABASE_URL) to the jobs:
 *
 *   deadline loop        setInterval every 5 s — second-precision deadlines
 *   deadline-watchdog    singleton cron backing the loop up (minute level)
 *   refund-retry-scan    singleton cron sweeping stuck refunds
 *   refund-retry         per-refund retry with exponential backoff
 *   reconciliation-daily singleton cron — daily money reconciliation
 *   genre-weekly         singleton cron — M_g recommendations (B5.4)
 *   payout-scan          singleton cron sweeping pending payouts
 *   payout-execute       per-payout SEPA execution (mock until Phase 8)
 *
 * Multiple worker processes are safe: crons are pg-boss singletons, work
 * queues dedupe on singletonKey, and every scan claims rows with
 * SKIP LOCKED while the services re-check state under their own locks.
 *
 * Graceful shutdown on SIGINT/SIGTERM: stop the loop, let in-flight jobs
 * finish (boss.stop graceful), close the pg pool, exit. A second signal
 * forces the exit.
 */

import PgBoss from "pg-boss";
import { env } from "@/lib/security/env";
import { closePool } from "@/lib/db";
import { loadWorkerEnv, type WorkerEnv } from "./env";
import { formatJobTable, type JobTableRow } from "./lib";
import {
  DEADLINE_WATCHDOG_QUEUE,
  scanDeadlines,
  startDeadlineLoop,
  type DeadlineLoopHandle,
} from "./jobs/deadlines";
import {
  REFUND_RETRY_QUEUE,
  REFUND_SCAN_QUEUE,
  enqueueStuckRefunds,
  processRefundRetry,
  type RefundRetryConfig,
  type RefundRetryJobData,
} from "./jobs/refund-retry";
import { RECONCILIATION_QUEUE, runDailyReconciliation } from "./jobs/reconciliation";
import { GENRE_WEEKLY_QUEUE, runGenreWeekly } from "./jobs/genre-weekly";
import {
  PAYOUT_EXECUTE_QUEUE,
  PAYOUT_SCAN_QUEUE,
  enqueuePendingPayouts,
  executePayoutJob,
  type PayoutJobData,
} from "./jobs/payouts";

/* ------------------------------------------------------------------ */
/* Registration plan                                                   */
/* ------------------------------------------------------------------ */

interface QueuePlan {
  name: string;
  policy: "standard" | "singleton";
  /** Cron expression when the queue is schedule-driven. */
  cron?: string;
  duty: string;
}

function buildPlan(cfg: WorkerEnv): QueuePlan[] {
  return [
    {
      name: DEADLINE_WATCHDOG_QUEUE,
      policy: "singleton",
      cron: cfg.WORKER_WATCHDOG_CRON,
      duty: `deadline watchdog (loop runs every ${cfg.WORKER_DEADLINE_INTERVAL_MS} ms)`,
    },
    {
      name: REFUND_SCAN_QUEUE,
      policy: "singleton",
      cron: cfg.WORKER_REFUND_SCAN_CRON,
      duty: "sweep failed/stuck refunds into refund-retry (B4.4)",
    },
    {
      name: REFUND_RETRY_QUEUE,
      policy: "standard",
      duty: `retry refunds, backoff ×2 from ${cfg.WORKER_REFUND_RETRY_DELAY_SEC}s, alert after ${cfg.WORKER_REFUND_MAX_ATTEMPTS} attempts`,
    },
    {
      name: RECONCILIATION_QUEUE,
      policy: "singleton",
      cron: cfg.WORKER_RECONCILIATION_CRON,
      duty: "daily payments vs ledger vs refunds reconciliation (B4.3)",
    },
    {
      name: GENRE_WEEKLY_QUEUE,
      policy: "singleton",
      cron: cfg.WORKER_GENRE_CRON,
      duty: `weekly genre multiplier recommendations, ≥${cfg.WORKER_GENRE_MIN_QUOTES} quotes/${cfg.WORKER_GENRE_WINDOW_DAYS}d (B5.4)`,
    },
    {
      name: PAYOUT_SCAN_QUEUE,
      policy: "singleton",
      cron: cfg.WORKER_PAYOUT_SCAN_CRON,
      duty: "sweep pending payouts of ended sessions (B4.5)",
    },
    {
      name: PAYOUT_EXECUTE_QUEUE,
      policy: "standard",
      duty: "execute one payout: processing → mock SEPA → paid + ledger",
    },
  ];
}

function planTable(plan: QueuePlan[], cfg: WorkerEnv): string {
  const rows: JobTableRow[] = [
    {
      queue: "(in-process loop)",
      trigger: `every ${cfg.WORKER_DEADLINE_INTERVAL_MS} ms`,
      duty: "second-precision deadline scan (B4.1/B4.2)",
    },
    ...plan.map((p) => ({
      queue: p.name,
      trigger: p.cron ? `cron ${p.cron} (${cfg.WORKER_CRON_TZ})` : "queue (on send)",
      duty: p.duty,
    })),
  ];
  return formatJobTable(rows);
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

/** Loops a batch handler over the jobs pg-boss hands us (batchSize = 1). */
function perJob<T extends object>(
  fn: (data: T, now: number) => Promise<unknown>,
): (jobs: PgBoss.Job<T>[]) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      // The ONE place wall-clock time enters a job: `now` is injected
      // into everything below (B11 "Tempo").
      await fn(job.data, Date.now());
    }
  };
}

export async function runWorker(): Promise<void> {
  const cfg = loadWorkerEnv();
  const plan = buildPlan(cfg);

  // `WORKER_DRY_RUN=1` prints the registration plan and exits — a smoke
  // check for CI and for reviewing configuration without a database.
  if (process.env.WORKER_DRY_RUN === "1") {
    console.log("[worker] dry run — would register:\n" + planTable(plan, cfg));
    return;
  }

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    application_name: "betbeat-worker",
  });
  boss.on("error", (error) => {
    console.error(`[worker] pg-boss error: ${error.message}`);
  });

  await boss.start();

  for (const queue of plan) {
    await boss.createQueue(queue.name, { name: queue.name, policy: queue.policy });
  }

  const refundConfig: RefundRetryConfig = {
    maxAttempts: cfg.WORKER_REFUND_MAX_ATTEMPTS,
    retryDelaySec: cfg.WORKER_REFUND_RETRY_DELAY_SEC,
    stuckSec: cfg.WORKER_REFUND_STUCK_SEC,
    batch: cfg.WORKER_SCAN_BATCH,
  };
  const scanConfig = {
    batch: cfg.WORKER_SCAN_BATCH,
    sessionGraceMin: cfg.WORKER_SESSION_GRACE_MIN,
  };

  /* Handlers. */
  await boss.work(
    DEADLINE_WATCHDOG_QUEUE,
    perJob(async (_data, now) => scanDeadlines(now, scanConfig)),
  );
  await boss.work(
    REFUND_SCAN_QUEUE,
    perJob(async (_data, now) => enqueueStuckRefunds(boss, now, refundConfig)),
  );
  await boss.work<RefundRetryJobData>(
    REFUND_RETRY_QUEUE,
    perJob(async (data, now) => processRefundRetry(data, now, refundConfig)),
  );
  await boss.work(
    RECONCILIATION_QUEUE,
    perJob(async (_data, now) => runDailyReconciliation(now)),
  );
  await boss.work(
    GENRE_WEEKLY_QUEUE,
    perJob(async (_data, now) =>
      runGenreWeekly(now, {
        minQuotes: cfg.WORKER_GENRE_MIN_QUOTES,
        windowDays: cfg.WORKER_GENRE_WINDOW_DAYS,
      }),
    ),
  );
  await boss.work(
    PAYOUT_SCAN_QUEUE,
    perJob(async (_data, now) =>
      enqueuePendingPayouts(boss, now, { batch: cfg.WORKER_SCAN_BATCH }),
    ),
  );
  await boss.work<PayoutJobData>(
    PAYOUT_EXECUTE_QUEUE,
    perJob(async (data, now) => executePayoutJob(data, now)),
  );

  /* Schedules (upserts — a changed env cron takes effect on restart). */
  const tz = cfg.WORKER_CRON_TZ;
  for (const queue of plan) {
    if (queue.cron) {
      await boss.schedule(queue.name, queue.cron, {}, { tz });
    }
  }

  /* The fast loop for second-precision deadlines (B4.2). */
  const loop: DeadlineLoopHandle = startDeadlineLoop({
    ...scanConfig,
    intervalMs: cfg.WORKER_DEADLINE_INTERVAL_MS,
  });

  console.log("[worker] BetBeat worker started — registered jobs:\n" + planTable(plan, cfg));

  /* Graceful shutdown. */
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      console.error(`[worker] ${signal} again — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[worker] ${signal} received — draining…`);
    loop.stop();
    void (async () => {
      try {
        await boss.stop({ graceful: true, wait: true, timeout: 30_000 });
      } catch (error) {
        console.error(
          `[worker] pg-boss stop failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      try {
        await closePool();
      } catch {
        // pool already gone
      }
      console.log("[worker] bye");
      process.exit(0);
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
