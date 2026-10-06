import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIpFrom } from "@/lib/security/client-ip";
import { verifyToken } from "@/lib/security/tokens";
import { rateLimit } from "@/lib/security/rate-limit";
import { getDisplayState } from "../../_lib/state";

/**
 * GET /api/display/[token]/state — public display DTO (BRIEF B8).
 *
 * Poll fallback for the venue screen when the realtime subscription is
 * unavailable. Verifies the signed display token, returns PUBLIC data only.
 * Light rate limit (60/min per IP) + 5s cache headers: a venue screen polls
 * at most every 10s, so this is generous headroom without inviting abuse.
 */

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  // HMAC token format: <base64url body>.<base64url mac>
  token: z
    .string()
    .min(16)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = rateLimit(`display-state:${clientIpFrom(request.headers)}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  const raw = await context.params;
  const parsed = paramsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const payload = verifyToken(parsed.data.token);
  if (!payload || payload.kind !== "display") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const state = await getDisplayState(payload);
  if (!state) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(state.dto, {
    headers: { "Cache-Control": "public, max-age=5" },
  });
}
