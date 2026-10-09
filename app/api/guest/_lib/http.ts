import "server-only";

/**
 * Shared HTTP helpers for the guest API surface (BRIEF B12.4).
 *
 * Every error leaving these routes is GENERIC: `{ error: { code, id } }`
 * where `code` is a stable machine key the client translates and `id` is
 * a short correlation id that is also logged server-side (never with PII).
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIpFrom } from "@/lib/security/client-ip";

export interface ApiErrorBody {
  error: { code: string; id: string };
}

export function correlationId(): string {
  return randomUUID().slice(0, 8);
}

/** Generic error response + server-side log line (no PII, B12.4). */
export function apiError(
  code: string,
  status: number,
  logDetail?: string,
): NextResponse<ApiErrorBody> {
  const id = correlationId();
  console.error(`[api:guest] ${id} ${code}${logDetail ? ` — ${logDetail}` : ""}`);
  return NextResponse.json({ error: { code, id } }, { status });
}

export function rateLimitedResponse(): NextResponse<ApiErrorBody> {
  return apiError("rate_limited", 429);
}

/** Client IP for per-IP rate limiting (spoof-resistant, see lib/security/client-ip). */
export function clientIp(request: Request): string {
  return clientIpFrom(request.headers);
}
