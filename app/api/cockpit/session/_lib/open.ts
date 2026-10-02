import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { publicChannel, staffChannel } from "@/lib/realtime/events";
import { publishBroadcasts } from "@/lib/realtime/publish";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

/**
 * Shared pause/resume handler (B7 top bar switch): flips
 * `sessions.requests_open` and broadcasts `session.paused` so guests and
 * the display react instantly. The session row itself stays `live`.
 */
export function createOpenHandler(open: boolean) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
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
    try {
      const res = await getPool().query(
        `update public.sessions set requests_open = $2
          where id = $1 and status = 'live'`,
        [scope.sessionId, open],
      );
      if ((res.rowCount ?? 0) === 0) return apiError(409, "session_not_live");

      await getPool().query(
        `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
         values ($1, $2, 'session', $3, $4, $5)`,
        [
          auth.ctx.actor,
          open ? "session.requests_resumed" : "session.requests_paused",
          scope.sessionId,
          scope.venueId,
          JSON.stringify({ requestsOpen: open }),
        ],
      );

      const payload = { sessionId: scope.sessionId, requestsOpen: open };
      await publishBroadcasts(
        [
          {
            topic: staffChannel(scope.sessionId),
            event: "session.paused",
            payload,
            private: true,
          },
          {
            topic: publicChannel(scope.sessionId),
            event: "session.paused",
            payload,
            private: false,
          },
        ],
        now,
      );
      return NextResponse.json({ ok: true, requestsOpen: open });
    } catch (error) {
      const correlationId = Math.random().toString(16).slice(2, 10);
      console.error(
        `[cockpit:open] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return apiError(500, "internal", correlationId);
    }
  };
}
