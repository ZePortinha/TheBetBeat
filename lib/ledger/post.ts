import "server-only";

/**
 * Server-only ledger writer (BRIEF B4.5).
 *
 * The ledger is append-only and immutable (a DB trigger forbids UPDATE and
 * DELETE), so posting is the only write path. The caller owns the transaction:
 * `postLedgerGroup` runs inside whatever BEGIN/COMMIT the caller manages, so a
 * payment capture, its request_event and its ledger group commit atomically.
 */

import type { PoolClient } from "pg";
import type { LedgerLine } from "./accounts";
import { assertZeroSum } from "./groups";

/**
 * Validates the group (zero-sum, non-zero safe-integer amounts) and inserts
 * every line under a single fresh `group_id`, using one parameterized
 * multi-row INSERT. Returns the `group_id`.
 *
 * Must be called inside the caller's transaction on `db`.
 */
export async function postLedgerGroup(db: PoolClient, lines: LedgerLine[]): Promise<string> {
  if (lines.length === 0) {
    throw new Error("Cannot post an empty ledger group");
  }
  assertZeroSum(lines);

  const groupId = crypto.randomUUID();
  const columns = ["group_id", "account", "venue_id", "session_id", "request_id", "amount_cents", "memo"];
  const values: unknown[] = [];
  const rows: string[] = [];

  for (const l of lines) {
    const base = values.length;
    values.push(
      groupId,
      l.account,
      l.venueId ?? null,
      l.sessionId ?? null,
      l.requestId ?? null,
      l.amountCents,
      l.memo ?? null,
    );
    const placeholders = columns.map((_, i) => `$${base + i + 1}`);
    rows.push(`(${placeholders.join(", ")})`);
  }

  await db.query(
    `insert into public.ledger_entries (${columns.join(", ")}) values ${rows.join(", ")}`,
    values,
  );

  return groupId;
}
