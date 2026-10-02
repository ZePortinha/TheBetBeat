import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

/**
 * POST /api/cockpit/session/genres — genre blocks (B4.6 "Géneros …
 * bloqueáveis", B7 Definições). Blocking a genre flags every library
 * track of that genre `blocked`, which the quote service already
 * enforces (`track_blocked`), so blocked genres cannot be requested.
 */
const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    genre: z.string().min(1).max(64),
    blocked: z.boolean(),
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
  const { sessionId, genre, blocked } = parsed.data;

  const scope = await authorizeSession(auth.ctx, sessionId);
  if (!scope) return apiError(403, "forbidden");

  try {
    const res = await getPool().query(
      `update public.library_tracks set blocked = $3
        where venue_id = $1 and genre = $2`,
      [scope.venueId, genre, blocked],
    );
    if ((res.rowCount ?? 0) === 0) return apiError(400, "unknown_genre");

    await getPool().query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ($1, 'session.genre_block', 'session', $2, $3, $4)`,
      [
        auth.ctx.actor,
        scope.sessionId,
        scope.venueId,
        JSON.stringify({ genre, blocked }),
      ],
    );
    return NextResponse.json({ ok: true, genre, blocked });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:genres] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
