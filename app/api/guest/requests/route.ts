import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { toGuestRequestDto, type RequestRow } from "@/lib/domain/dto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { getGuestIdentity } from "../_lib/auth";

export const dynamic = "force-dynamic";

// Buying tiers (POST) ended with the slot auctions (2026-10-05): bids go
// through /api/guest/auction/bid. Old requests stay readable here.

/** GET /api/guest/requests — the guest's own history (B6.9), minimal DTO. */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `requests-list:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const res = await getPool().query<RequestRow & { invoice_ref: string | null }>(
    `select r.*, i.provider_ref as invoice_ref
       from public.requests r
       left join public.invoices i on i.request_id = r.id
      where r.guest_id = $1
      order by r.created_at desc
      limit 50`,
    [identity.guestId],
  );

  return NextResponse.json({
    requests: res.rows.map((row) => ({
      ...toGuestRequestDto(row),
      sessionId: row.session_id,
      invoiceRef: row.invoice_ref,
    })),
  });
}
