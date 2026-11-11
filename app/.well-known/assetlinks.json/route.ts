import { NextResponse } from "next/server";
import { androidAssetLinks, NATIVE_APP_ID } from "@/lib/native/app-links";
import { env } from "@/lib/security/env";

export const dynamic = "force-dynamic";

/** Android App Links for the Play app. Off until ANDROID_CERT_SHA256 is set. */
export function GET() {
  const links = env.ANDROID_CERT_SHA256 ? androidAssetLinks(NATIVE_APP_ID, env.ANDROID_CERT_SHA256) : null;
  if (!links) return new NextResponse(null, { status: 404 });
  return NextResponse.json(links, { headers: { "cache-control": "public, max-age=3600" } });
}
