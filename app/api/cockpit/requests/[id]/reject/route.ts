import { z } from "zod";
import { REJECT_REASONS } from "@/lib/domain/types";
import { djReject } from "@/lib/domain/service";
import { createRequestActionHandler } from "../../../_lib/actions";

const bodySchema = z.object({ reason: z.enum(REJECT_REASONS) }).strict();

/** POST /api/cockpit/requests/[id]/reject — paid → refunded (full, B4.1). */
export const POST = createRequestActionHandler(
  "reject",
  bodySchema,
  ({ ctx, requestId, body, now }) => djReject(requestId, body.reason, ctx.actor, now),
);
