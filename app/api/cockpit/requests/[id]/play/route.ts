import { z } from "zod";
import { getPool } from "@/lib/db";
import { djMarkPlaying, markTrackFinished } from "@/lib/domain/service";
import { createRequestActionHandler } from "../../../_lib/actions";

const bodySchema = z.object({}).strict();

/**
 * POST /api/cockpit/requests/[id]/play — accepted → playing (captures the
 * payment, B4.3). When another request is already playing in this session
 * the DJ marking the next one closes it first: `played` is automatic on
 * duration OR when the DJ marks the next (B4.2 "Faixa tocada").
 */
export const POST = createRequestActionHandler(
  "play",
  bodySchema,
  async ({ ctx, requestId, sessionId, now }) => {
    const playing = await getPool().query<{ id: string }>(
      `select id from public.requests
        where session_id = $1 and status = 'playing' and id <> $2`,
      [sessionId, requestId],
    );
    for (const { id } of playing.rows) {
      await markTrackFinished(id, ctx.actor, now);
    }
    return djMarkPlaying(requestId, ctx.actor, now);
  },
);
