import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { toGuestRequestDto, type RequestRow } from "@/lib/domain/dto";
import { parseSessionConfig } from "@/lib/domain/config";
import { orderQueue } from "@/lib/domain/ordering";
import type { PaymentMethod, PaymentStatus, Tier } from "@/lib/domain/types";
import { etaDisplayMin, requestIntervalMin } from "@/lib/pricing";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { getGuestIdentity } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Live queue position + ETA for the guest's own request (B5.5): position
 * inside its tier per the B5.5 ordering; ETA from the i = 60/R interval.
 */
async function computePositionEta(
  row: RequestRow,
): Promise<{ position: number | null; etaMin: number | null }> {
  if (row.status !== "paid" && row.status !== "accepted") {
    return { position: null, etaMin: null };
  }
  const pool = getPool();
  const [queueRes, cfgRes, nowTrackRes] = await Promise.all([
    pool.query<{
      id: string;
      tier: Tier;
      amount_cents: number;
      paid_at: Date | null;
      deadline_at: Date | null;
    }>(
      `select id, tier, amount_cents, paid_at, deadline_at
         from public.requests
        where session_id = $1 and status in ('paid', 'accepted')`,
      [row.session_id],
    ),
    pool.query<{ config: unknown }>(
      `select coalesce(ss.config, '{}'::jsonb) as config
         from public.sessions s
         left join public.session_settings ss on ss.session_id = s.id
        where s.id = $1`,
      [row.session_id],
    ),
    pool.query<{ started_at: Date; duration_sec: number | null }>(
      `select started_at, duration_sec from public.session_tracks
        where session_id = $1 order by started_at desc limit 1`,
      [row.session_id],
    ),
  ]);

  const now = Date.now();
  const config = parseSessionConfig(cfgRes.rows[0]?.config);
  const interval = requestIntervalMin(config.acceptanceRatePerHour);

  const ordered = orderQueue(
    queueRes.rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      amountCents: r.amount_cents,
      paidAt: (r.paid_at ?? new Date(now)).toISOString(),
      deadlineAt: r.deadline_at ? r.deadline_at.toISOString() : null,
    })),
    now,
  );
  const sameTier = ordered.filter((r) => r.tier === row.tier);
  const index = sameTier.findIndex((r) => r.id === row.id);
  if (index < 0) return { position: null, etaMin: null };
  const position = index + 1;

  const counts = { QUEUE: 0, SOON: 0, NEXT: 0 } as Record<Tier, number>;
  for (const r of ordered) counts[r.tier] += 1;

  let rawEta: number;
  if (row.tier === "NEXT") {
    const latest = nowTrackRes.rows[0];
    const remainingSec =
      latest && latest.duration_sec !== null
        ? Math.max(0, (latest.started_at.getTime() + latest.duration_sec * 1000 - now) / 1000)
        : null;
    rawEta = remainingSec !== null ? remainingSec / 60 : interval / 2;
  } else if (row.tier === "SOON") {
    rawEta = (counts.NEXT + position) * interval;
  } else {
    rawEta = (counts.NEXT + counts.SOON + position) * interval;
  }
  return { position, etaMin: etaDisplayMin(rawEta) };
}

/** GET /api/guest/requests/[id] — own request only (tracking screen). */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `request-get:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return apiError("invalid_request", 400);

  const pool = getPool();
  const res = await pool.query<RequestRow>(
    `select * from public.requests where id = $1 and guest_id = $2`,
    [parsed.data.id, identity.guestId],
  );
  const row = res.rows[0];
  if (!row) return apiError("not_found", 404);

  const [{ position, etaMin }, paymentRes] = await Promise.all([
    computePositionEta(row),
    pool.query<{
      method: PaymentMethod;
      status: PaymentStatus;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `select method, status, expires_at, created_at
         from public.payments
        where request_id = $1 and idempotency_key = $2`,
      [row.id, `pay:${row.id}`],
    ),
  ]);
  const payment = paymentRes.rows[0];

  return NextResponse.json({
    ...toGuestRequestDto(row),
    queuePosition: position,
    etaMin,
    payment: payment
      ? {
          method: payment.method,
          status: payment.status,
          expiresAt: payment.expires_at ? payment.expires_at.toISOString() : null,
          createdAt: payment.created_at.toISOString(),
        }
      : null,
  });
}
