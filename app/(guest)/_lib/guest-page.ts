import "server-only";

/**
 * Shared entry for every guest route page: decode the QR token from the
 * URL segment and resolve it to the venue's live session (B4.7 signed
 * tokens). Pages render <TokenError> on failure — never a stack trace.
 */

import { resolveGuestContext, type ResolveResult } from "@/app/api/guest/_lib/context";

export interface GuestPageParams {
  qrToken: string;
}

export async function resolveGuestPage(
  params: Promise<GuestPageParams>,
): Promise<{ token: string; resolved: ResolveResult }> {
  const { qrToken } = await params;
  const token = decodeURIComponent(qrToken);
  const resolved = await resolveGuestContext(token);
  return { token, resolved };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
