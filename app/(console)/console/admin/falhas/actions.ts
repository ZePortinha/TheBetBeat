"use server";

/**
 * Admin BetBeat — Falhas (B9 admin): "Repetir" a failed refund.
 *
 * The console never talks to the PSP. It resets the refund row to
 * `pending` with a fresh attempt budget; the worker's refund sweep
 * (worker/jobs/refund-retry.ts) picks up stuck pending refunds and runs
 * the exactly-once retry (same idempotency key — B4.4). Audited.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { audit, requireAdminConsole } from "../../_lib/context";

const retrySchema = z.object({ refundId: z.string().uuid() }).strict();

export async function retryRefundAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminConsole("/console/admin/falhas");
  const parsed = retrySchema.safeParse({ refundId: formData.get("refundId") });
  if (!parsed.success) redirect("/console/admin/falhas?error=invalid");

  const res = await query<{ id: string; venue_id: string; attempts: number }>(
    `update public.refunds rf
        set status = 'pending', attempts = 0, last_error = null, updated_at = now()
       from public.requests r
      where rf.id = $1 and rf.status = 'failed' and r.id = rf.request_id
      returning rf.id, r.venue_id, rf.attempts`,
    [parsed.data.refundId],
  );
  const row = res.rows[0];
  if (!row) redirect("/console/admin/falhas?error=notRetryable");

  await audit(ctx, "refund.retry_requested", "refund", row.id, row.venue_id, {
    resetTo: "pending",
  });
  revalidatePath("/console/admin/falhas");
  redirect("/console/admin/falhas?retried=1");
}
