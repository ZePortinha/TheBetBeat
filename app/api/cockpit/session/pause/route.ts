import { createOpenHandler } from "../_lib/open";

/** POST /api/cockpit/session/pause — close requests (B7 top bar). */
export const POST = createOpenHandler(false);
