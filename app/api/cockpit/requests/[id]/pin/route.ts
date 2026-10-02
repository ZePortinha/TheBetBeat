import { z } from "zod";
import { getPool } from "@/lib/db";
import { djPin } from "@/lib/domain/service";
import { createRequestActionHandler } from "../../../_lib/actions";

const bodySchema = z.object({ pinned: z.boolean() }).strict();

/**
 * POST /api/cockpit/requests/[id]/pin — "Fixar como próxima" (B7).
 * Only one pinned request per session: pinning unpins any sibling first.
 */
export const POST = createRequestActionHandler(
  "pin",
  bodySchema,
  async ({ ctx, requestId, sessionId, body, now }) => {
    if (body.pinned) {
      const siblings = await getPool().query<{ id: string }>(
        `select id from public.requests
          where session_id = $1 and pinned_next = true and id <> $2
            and status in ('paid', 'accepted')`,
        [sessionId, requestId],
      );
      for (const { id } of siblings.rows) {
        await djPin(id, false, ctx.actor, now);
      }
    }
    return djPin(requestId, body.pinned, ctx.actor, now);
  },
);
