import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

/**
 * POST /api/cockpit/session/transfer — hand the live set to another DJ
 * of the SAME venue (B7 Definições "Passar a sessão a outro DJ").
 */
const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    staffId: z.string().uuid(),
  })
  .strict();

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
  const { sessionId, staffId } = parsed.data;

  const scope = await authorizeSession(auth.ctx, sessionId);
  if (!scope) return apiError(403, "forbidden");

  try {
    // The target must be a DJ of this venue — never cross-venue.
    const staffRes = await getPool().query<{ display_name: string }>(
      `select display_name from public.staff
        where id = $1 and venue_id = $2 and role = 'dj'`,
      [staffId, scope.venueId],
    );
    const target = staffRes.rows[0];
    if (!target) return apiError(400, "unknown_dj");

    const res = await getPool().query(
      `update public.sessions set dj_staff_id = $2
        where id = $1 and status = 'live'`,
      [scope.sessionId, staffId],
    );
    if ((res.rowCount ?? 0) === 0) return apiError(409, "session_not_live");

    await getPool().query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ($1, 'session.transferred', 'session', $2, $3, $4)`,
      [auth.ctx.actor, scope.sessionId, scope.venueId, JSON.stringify({ toStaffId: staffId })],
    );
    return NextResponse.json({ ok: true, staffId, name: target.display_name });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:transfer] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
