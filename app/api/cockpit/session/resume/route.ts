import { createOpenHandler } from "../_lib/open";

/** POST /api/cockpit/session/resume — reopen requests (B7 top bar). */
export const POST = createOpenHandler(true);
