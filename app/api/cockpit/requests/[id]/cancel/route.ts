import { z } from "zod";
import { djCancel } from "@/lib/domain/service";
import { createRequestActionHandler } from "../../../_lib/actions";

const bodySchema = z.object({}).strict();

/** POST /api/cockpit/requests/[id]/cancel — accepted → refunded (full). */
export const POST = createRequestActionHandler(
  "cancel",
  bodySchema,
  ({ ctx, requestId, now }) => djCancel(requestId, ctx.actor, now),
);
