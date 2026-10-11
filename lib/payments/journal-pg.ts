/**
 * Postgres PSP journal (table public.psp_operations, migration 0013).
 * Each call commits on its own connection, outside any caller transaction:
 * a request transition that rolls back must not erase the record that a
 * refund was already sent.
 */
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import type { PaymentIntentResult } from "./types";
import {
  refundCap,
  type ClaimInput,
  type ClaimResult,
  type PspJournal,
  type PspOperation,
  type PspOperationState,
} from "./journal";

interface Row {
  idempotency_key: string;
  kind: PspOperation["kind"];
  state: PspOperationState;
  provider_ref: string | null;
  order_id: string | null;
  amount_cents: number;
  result: PaymentIntentResult | null;
  paid_at: Date | null;
}

const toOp = (r: Row): PspOperation => ({
  key: r.idempotency_key,
  kind: r.kind,
  state: r.state,
  providerRef: r.provider_ref,
  orderId: r.order_id,
  amountCents: r.amount_cents,
  result: r.result,
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
});

const COLUMNS = "idempotency_key, kind, state, provider_ref, order_id, amount_cents, result, paid_at";

async function capFor(client: PoolClient, input: ClaimInput) {
  const res = await client.query<Row>(
    `select ${COLUMNS} from public.psp_operations where provider_ref = $1`,
    [input.providerRef],
  );
  return refundCap(res.rows.map(toOp), input);
}

export const pgJournal: PspJournal = {
  async claim(input: ClaimInput): Promise<ClaimResult> {
    return withTransaction(async (client) => {
      // One payment's refunds are claimed one at a time (cap check).
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
        `psp:${input.providerRef ?? input.key}`,
      ]);
      const existing = await client.query<Row>(
        `select ${COLUMNS} from public.psp_operations where idempotency_key = $1 for update`,
        [input.key],
      );
      const row = existing.rows[0];
      if (row && row.state !== "refused") return { claimed: false, reason: "exists", existing: toOp(row) };
      if (input.kind === "refund") {
        const over = await capFor(client, input);
        if (over) return { claimed: false, reason: "over_cap", ...over };
      }
      await client.query(
        `insert into public.psp_operations
           (idempotency_key, kind, state, provider_ref, order_id, amount_cents)
         values ($1, $2, 'sending', $3, $4, $5)
         on conflict (idempotency_key) do update
           set state = 'sending', amount_cents = excluded.amount_cents, result = null, last_error = null`,
        [input.key, input.kind, input.providerRef, input.orderId, input.amountCents],
      );
      return { claimed: true };
    });
  },

  async finish(key, state, fields = {}) {
    await withTransaction((client) =>
      client.query(
        `update public.psp_operations
            set state = $2,
                provider_ref = coalesce($3, provider_ref),
                result = coalesce($4::jsonb, result),
                last_error = $5
          where idempotency_key = $1`,
        [
          key,
          state,
          fields.providerRef ?? null,
          fields.result ? JSON.stringify(fields.result) : null,
          fields.error?.slice(0, 500) ?? null,
        ],
      ),
    );
  },

  async markPaid(orderId, providerRef, at) {
    return withTransaction(async (client) => {
      const res = await client.query<Row>(
        `update public.psp_operations
            set provider_ref = $2, paid_at = coalesce(paid_at, $3::timestamptz)
          where kind = 'charge' and order_id = $1
          returning ${COLUMNS}`,
        [orderId, providerRef, at],
      );
      const row = res.rows[0];
      return row ? toOp(row) : null;
    });
  },
};
