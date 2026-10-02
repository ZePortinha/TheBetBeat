import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

const querySchema = z.object({ sessionId: z.string().uuid() }).strict();

/**
 * GET /api/cockpit/session/end-preview?sessionId= — what "Terminar set"
 * will refund (B7 Definições): the count and total value of requests
 * still active (paid/accepted/playing all refund in full on
 * session_ended, B4.1).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get("sessionId") ?? undefined,
  });
  if (!parsed.success) return apiError(400, "invalid_query");

  const scope = await authorizeSession(auth.ctx, parsed.data.sessionId);
  if (!scope) return apiError(403, "forbidden");

  try {
    const res = await getPool().query<{ n: string; total: string }>(
      `select count(*)::bigint as n, coalesce(sum(amount_cents), 0)::bigint as total
         from public.requests
        where session_id = $1
          and status in ('pending_payment', 'paid', 'accepted', 'playing')`,
      [scope.sessionId],
    );
    const row = res.rows[0];
    return NextResponse.json({
      count: Number(row?.n ?? 0),
      refundCents: Number(row?.total ?? 0),
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:end-preview] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
