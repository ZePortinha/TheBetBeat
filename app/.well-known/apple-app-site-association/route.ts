import { NextResponse } from "next/server";
import { appleAppSiteAssociation } from "@/lib/native/app-links";
import { env } from "@/lib/security/env";

export const dynamic = "force-dynamic";

/** Universal links for the iOS app (no file extension, served as JSON). Off until APPLE_TEAM_ID is set. */
export function GET() {
  if (!env.APPLE_TEAM_ID) return new NextResponse(null, { status: 404 });
  return NextResponse.json(appleAppSiteAssociation(env.APPLE_TEAM_ID, env.APNS_BUNDLE_ID), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
