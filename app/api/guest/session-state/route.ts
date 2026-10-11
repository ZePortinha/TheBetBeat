import { NextResponse } from "next/server";
import { z } from "zod";
import { createMicroCache } from "@/lib/cache/micro";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError, clientIp, rateLimitedResponse } from "../_lib/http";
import { resolveGuestContext } from "../_lib/context";
import { buildSessionState, type PublicSessionState } from "../_lib/session-state";

export const dynamic = "force-dynamic";

const querySchema = z.object({ token: z.string().min(1).max(1024) });

/** Public data, the same for every phone at the party: one read per second per session. */
const cached = createMicroCache<PublicSessionState>(1_000);

/**
 * Per IP, but generous: a whole club shares one Wi-Fi address, and every
 * phone polls this. The micro-cache is what keeps the database safe.
 */
const PER_IP = { limit: 1_200, windowMs: 60_000 };

/** GET /api/guest/session-state?token=… — public data only (B6.7/B6.8). */
export async function GET(request: Request) {
  // Per-IP limit: this endpoint is unauthenticated (public data only).
  const limit = rateLimit(`session-state:${clientIp(request)}`, PER_IP.limit, PER_IP.windowMs);
  if (!limit.ok) return rateLimitedResponse();

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ token: url.searchParams.get("token") ?? "" });
  if (!parsed.success) return apiError("invalid_request", 400);

  const resolved = await resolveGuestContext(parsed.data.token);
  if (!resolved.ok) {
    return apiError(
      resolved.error === "invalid_token" ? "invalid_token" : "session_not_live",
      resolved.error === "invalid_token" ? 404 : 409,
    );
  }

  const state = await cached(resolved.ctx.sessionId, () => buildSessionState(resolved.ctx));
  return NextResponse.json(state);
}
