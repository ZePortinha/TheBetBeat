/**
 * Daily reconciliation (BRIEF B4.3 "reconciliação diária automática").
 *
 * Runs every morning (pg-boss schedule, default '0 5 * * *') and compares
 * the three money flows across their two independent records:
 *
 *   payments.captured_cents   vs  ledger psp_clearing debits (captures)
 *   refunds succeeded totals  vs  ledger refund groups
 *   payouts paid totals       vs  ledger payout groups
 *
 * Each pair is written atomically by one service transaction, so the
 * CUMULATIVE totals must match exactly at any instant. All six sums are
 * read inside a single REPEATABLE READ snapshot — a capture committing
 * mid-report can never fake a mismatch. On top of the invariants, the
 * report carries yesterday's activity (window-scoped ledger sums) so the
 * daily audit row doubles as a statement of the day.
 *
 * The report is an audit_log row (action 'reconciliation.daily') and any
 * mismatch is logged LOUDLY — a mismatch means money moved without its
 * ledger trail (or vice versa) and demands a human (B4.4 spirit).
 */

import { withTransaction } from "@/lib/db";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import {
  reconcileTotals,
  utcYesterdayWindow,
  type ReconciliationDiff,
  type ReconciliationTotals,
} from "../lib";

export const RECONCILIATION_QUEUE = "reconciliation-daily";

/** Yesterday's money activity, window-scoped over the ledger (cents). */
export interface DayActivity {
  capturedCents: number;
  refundedCents: number;
  recognizedCents: number;
  payoutCents: number;
}

export interface ReconciliationReport {
  /** YYYY-MM-DD (UTC) the report covers. */
  day: string;
  windowStart: string;
  windowEnd: string;
  activity: DayActivity;
  totals: ReconciliationTotals;
  ok: boolean;
  mismatches: ReconciliationDiff["mismatches"];
}

function asInt(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`reconciliation sum is not a safe integer: ${String(value)}`);
  }
  return n;
}

/** Runs the reconciliation for the day before `now` and writes the report. */
export async function runDailyReconciliation(now: number): Promise<ReconciliationReport> {
  const window = utcYesterdayWindow(now);

  const report = await withTransaction(async (client) => {
    // One consistent snapshot for every sum below.
    await client.query("set transaction isolation level repeatable read");

    const sums = await client.query<{
      payments_captured: string;
      refunds_succeeded: string;
      payouts_paid: string;
      ledger_captured: string;
      ledger_refunded: string;
      ledger_payout: string;
    }>(
      `select
         (select coalesce(sum(captured_cents), 0)::bigint from public.payments)
           as payments_captured,
         (select coalesce(sum(amount_cents), 0)::bigint from public.refunds
           where status = 'succeeded') as refunds_succeeded,
         (select coalesce(sum(amount_cents), 0)::bigint from public.payouts
           where status = 'paid') as payouts_paid,
         (select coalesce(sum(amount_cents), 0)::bigint from public.ledger_entries
           where account = $1 and amount_cents > 0) as ledger_captured,
         (select coalesce(sum(amount_cents), 0)::bigint from public.ledger_entries
           where account = $2 and amount_cents > 0 and memo like 'refund:%')
           as ledger_refunded,
         (select coalesce(sum(amount_cents), 0)::bigint from public.ledger_entries
           where account in ($3, $4) and amount_cents > 0 and memo like 'payout:%')
           as ledger_payout`,
      [
        ACCOUNTS.pspClearing,
        ACCOUNTS.guestEscrow,
        ACCOUNTS.venuePayable,
        ACCOUNTS.djPayable,
      ],
    );
    const sumRow = sums.rows[0];
    if (!sumRow) throw new Error("reconciliation sums query returned no row");

    const activityRes = await client.query<{
      captured: string;
      refunded: string;
      recognized: string;
      payout: string;
    }>(
      `select
         coalesce(sum(amount_cents) filter (where account = $3 and amount_cents > 0), 0)::bigint
           as captured,
         coalesce(sum(amount_cents) filter (where account = $4 and amount_cents > 0
           and memo like 'refund:%'), 0)::bigint as refunded,
         coalesce(sum(amount_cents) filter (where account = $4 and amount_cents > 0
           and memo like 'recognition:%'), 0)::bigint as recognized,
         coalesce(sum(amount_cents) filter (where account in ($5, $6) and amount_cents > 0
           and memo like 'payout:%'), 0)::bigint as payout
       from public.ledger_entries
      where created_at >= to_timestamp($1 / 1000.0)
        and created_at < to_timestamp($2 / 1000.0)`,
      [
        window.startMs,
        window.endMs,
        ACCOUNTS.pspClearing,
        ACCOUNTS.guestEscrow,
        ACCOUNTS.venuePayable,
        ACCOUNTS.djPayable,
      ],
    );
    const activityRow = activityRes.rows[0];

    const totals: ReconciliationTotals = {
      paymentsCapturedCents: asInt(sumRow.payments_captured),
      ledgerCapturedCents: asInt(sumRow.ledger_captured),
      refundsSucceededCents: asInt(sumRow.refunds_succeeded),
      ledgerRefundedCents: asInt(sumRow.ledger_refunded),
      payoutsPaidCents: asInt(sumRow.payouts_paid),
      ledgerPayoutCents: asInt(sumRow.ledger_payout),
    };
    const diff = reconcileTotals(totals);

    const built: ReconciliationReport = {
      day: window.dayIso,
      windowStart: new Date(window.startMs).toISOString(),
      windowEnd: new Date(window.endMs).toISOString(),
      activity: {
        capturedCents: asInt(activityRow?.captured),
        refundedCents: asInt(activityRow?.refunded),
        recognizedCents: asInt(activityRow?.recognized),
        payoutCents: asInt(activityRow?.payout),
      },
      totals,
      ok: diff.ok,
      mismatches: diff.mismatches,
    };

    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, payload)
       values ('system:worker', 'reconciliation.daily', 'reconciliation', $1, $2)`,
      [built.day, JSON.stringify(built)],
    );
    return built;
  });

  if (report.ok) {
    console.log(
      `[worker:reconciliation] ${report.day} OK — captured ${report.activity.capturedCents}c, ` +
        `refunded ${report.activity.refundedCents}c, payouts ${report.activity.payoutCents}c`,
    );
  } else {
    // Loud by design: a mismatch is money without a matching ledger trail.
    console.error(
      `[worker:reconciliation] *** MISMATCH for ${report.day} — ` +
        report.mismatches
          .map((m) => `${m.kind}: table=${m.tableCents}c ledger=${m.ledgerCents}c Δ=${m.deltaCents}c`)
          .join("; ") +
        " ***",
    );
  }
  return report;
}
