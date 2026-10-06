"use client";

/**
 * Tiny typed fetch wrapper for the guest API. Errors arrive as
 * `{ error: { code, id } }` (B12.4) — the caller maps `code` to a
 * translated message and may show `id` as a support reference.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; id: string | null; status: number };

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (json as { error?: { code?: string; id?: string } } | null)?.error;
      return {
        ok: false,
        code: err?.code ?? "generic",
        id: err?.id ?? null,
        status: res.status,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network", id: null, status: 0 };
  }
}

/** Error codes that have a dedicated guest translation. */
const KNOWN_ERROR_CODES = new Set([
  "handle_taken",
  "rate_limited",
  "bot_check_failed",
  "quote_expired",
  "tier_unavailable",
  "guest_limit",
  "spend_limit",
  "already_requested",
  "recently_played",
  "phone_required",
  "nif_invalid",
  "session_not_live",
  "amount_below_price",
  "amount_above_limit",
  "not_upgradable",
  "requests_closed",
  "track_blocked",
  "track_not_found",
  "invalid_token",
  "not_found",
  "unauthorized",
  "code_invalid",
  "code_expired",
  "code_attempts",
  "sms_failed",
  "slot_not_found",
  "not_open",
  "closed",
  "below_minimum",
  "above_maximum",
  "track_fixed",
  "bid_not_found",
  "insufficient_funds",
  "below_track_minimum",
]);

/**
 * Maps an API error to a message using the `guest.errors` namespace.
 * `t` is a next-intl translator scoped to "guest.errors".
 */
export function errorMessage(
  t: (key: string, values?: Record<string, string | number>) => string,
  failure: { code: string; id: string | null },
): string {
  if (KNOWN_ERROR_CODES.has(failure.code)) return t(failure.code);
  if (failure.id) return t("withCode", { code: failure.id });
  return t("generic");
}
