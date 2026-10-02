import { z } from "zod";
import { djAccept } from "@/lib/domain/service";
import { createRequestActionHandler } from "../../../_lib/actions";

const bodySchema = z.object({}).strict();

/** POST /api/cockpit/requests/[id]/accept — paid → accepted (B7). */
export const POST = createRequestActionHandler(
  "accept",
  bodySchema,
  ({ ctx, requestId, now }) => djAccept(requestId, ctx.actor, now),
);
