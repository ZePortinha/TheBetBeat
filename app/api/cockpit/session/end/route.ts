import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { endSession } from "@/lib/domain/service";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";
import {
  idempotencyKeyFor,
  memoizeIdempotent,
  recallIdempotent,
} from "../../_lib/idempotency";

const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

/**
 * POST /api/cockpit/session/end — "Terminar set" (B7): closes the
 * session via the domain service (every active request refunds in full,
 * payouts become pending) and returns the set statement for the summary
 * screen. Idempotent: ending an ended session returns its statement.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError(400, "invalid_body");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_body");

  const scope = await authorizeSession(auth.ctx, parsed.data.sessionId);
  if (!scope) return apiError(403, "forbidden");

  const now = Date.now();
  const idemKey = idempotencyKeyFor(
    auth.ctx.userId,
    `end:${scope.sessionId}`,
    request.headers.get("idempotency-key"),
  );
  const memo = recallIdempotent(idemKey, now);
  if (memo) return NextResponse.json(memo.body, { status: memo.status });

  try {
    const outcome = await endSession(scope.sessionId, auth.ctx.actor, now);
    if (!outcome.ok) return apiError(403, "forbidden");
    const body = {
      ok: true,
      alreadyEnded: outcome.alreadyEnded,
      closedRequests: outcome.closedRequests,
      statement: outcome.statement,
    };
    memoizeIdempotent(idemKey, 200, body, now);
    return NextResponse.json(body);
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:end] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
