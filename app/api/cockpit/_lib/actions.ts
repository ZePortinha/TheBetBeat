import "server-only";

/**
 * Shared handler factory for the five cockpit request actions
 * (accept / reject / cancel / pin / play). Each route:
 *
 *   1. requires a staff session (dj/manager/admin) — B12.3;
 *   2. verifies the request belongs to a venue where the caller is
 *      staff (venue scoping, B12.2) — 403 otherwise, never 404;
 *   3. validates the body with a STRICT zod allowlist (B12.2);
 *   4. honours an `Idempotency-Key` header (retries replay the original
 *      response);
 *   5. applies the transition through lib/domain/service (the ONLY
 *      place state changes — B4.2).
 *
 * Deadlines are enforced by the worker's DB scans — routes never need
 * to enqueue the DeadlineJob hints that transitions return.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import type { TransitionOutcome } from "@/lib/domain/service";
import {
  apiError,
  authorizeRequest,
  requireStaffApi,
  type StaffApiContext,
} from "./auth";
import {
  idempotencyKeyFor,
  memoizeIdempotent,
  recallIdempotent,
} from "./idempotency";

export interface ActionContext<B> {
  ctx: StaffApiContext;
  requestId: string;
  sessionId: string;
  body: B;
  now: number;
}

/** Transition errors the DJ can act on get a stable code; 409 for races. */
function outcomeResponse(outcome: TransitionOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json({
      ok: true,
      requestId: outcome.requestId,
      status: outcome.status,
    });
  }
  return apiError(409, "invalid_transition");
}

export function createRequestActionHandler<B>(
  action: string,
  bodySchema: ZodType<B>,
  run: (params: ActionContext<B>) => Promise<TransitionOutcome>,
) {
  return async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    const auth = await requireStaffApi();
    if (!auth.ok) return auth.response;

    const { id } = await props.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(403, "forbidden");

    const scope = await authorizeRequest(auth.ctx, id);
    if (!scope) return apiError(403, "forbidden");

    let json: unknown = {};
    try {
      const text = await request.text();
      json = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return apiError(400, "invalid_body");
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return apiError(400, "invalid_body");

    const now = Date.now();
    const idemKey = idempotencyKeyFor(
      auth.ctx.userId,
      `${action}:${id}`,
      request.headers.get("idempotency-key"),
    );
    const memo = recallIdempotent(idemKey, now);
    if (memo) return NextResponse.json(memo.body, { status: memo.status });

    try {
      const outcome = await run({
        ctx: auth.ctx,
        requestId: id,
        sessionId: scope.sessionId,
        body: parsed.data,
        now,
      });
      const response = outcomeResponse(outcome);
      memoizeIdempotent(
        idemKey,
        response.status,
        await response.clone().json(),
        now,
      );
      return response;
    } catch (error) {
      const correlationId = Math.random().toString(16).slice(2, 10);
      console.error(
        `[cockpit:${action}] ${correlationId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      return apiError(500, "internal", correlationId);
    }
  };
}
