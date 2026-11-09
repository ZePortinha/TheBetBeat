/**
 * Scrubbing for error reports (B12.4 "Sentry com limpeza de dados").
 *
 * Every event leaves the process only after `scrubEvent` (Sentry
 * `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`). It is pure and
 * runs on the server, the edge, the worker and in the browser, so it has no
 * imports. What it removes:
 *
 * - phone numbers, emails, IBANs, JWTs, Supabase keys and bearer tokens in
 *   any string (messages, exception values, breadcrumbs, extra data);
 * - values under sensitive keys (password, token, cookie, phone, email…);
 * - request bodies, cookies and every header except a short allowlist;
 * - signed tokens in our URLs (`/s/<qrToken>`, `/display/<token>`) and
 *   sensitive query parameters;
 * - user identity beyond the opaque id (no email, username or IP).
 */

const FILTERED = "[filtered]";

const SENSITIVE_KEY =
  /(pass(word)?|secret|token|authori[sz]ation|cookie|phone|telem|e-?mail|iban|captcha|turnstile|api[-_]?key|otp|dsn|signature|anti[-_]?phishing|private[-_]?key|card)/i;

/** In query strings `code` is an auth or SMS code, never an error code. */
const SENSITIVE_QUERY_KEY = /^(code|sig|s)$/i;

/** Headers worth keeping for triage. Everything else is dropped. */
const HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-length",
  "content-type",
  "user-agent",
  "x-request-id",
]);

const STRING_RULES: Array<[RegExp, string]> = [
  // JWTs (Supabase access tokens, signed QR/display tokens).
  [/eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[token]"],
  // Supabase API keys.
  [/\bsb_(?:publishable|secret)_[\w-]+/g, "[token]"],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 [token]"],
  // Emails.
  [/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // IBANs (PT50 0002 0123 1234 5678 9015 4, with or without spaces).
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, "[iban]"],
  // Phone numbers: 9+ digits, optional +/00 prefix and single spaces/dashes.
  [/(?<![\w.-])(?:\+|00)?\d(?:[ -]?\d){8,14}(?![\w-])/g, "[phone]"],
];

/** Signed tokens that sit in our own URL paths. */
const PATH_RULES: Array<[RegExp, string]> = [
  [/(\/s\/)[^/?#\s]+/g, "$1[token]"],
  [/(\/display\/)[^/?#\s]+/g, "$1[token]"],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATH_RULES) out = out.replace(pattern, replacement);
  out = scrubQuery(out);
  for (const [pattern, replacement] of STRING_RULES) out = out.replace(pattern, replacement);
  return out;
}

/** `?token=…&page=2` → `?token=[filtered]&page=2`, anywhere in a string. */
function scrubQuery(value: string): string {
  return value.replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, sep: string, key: string) =>
    SENSITIVE_KEY.test(decodeSafe(key)) || SENSITIVE_QUERY_KEY.test(key) ? `${sep}${key}=${FILTERED}` : match,
  );
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const MAX_DEPTH = 8;

/** Deep copy with sensitive keys filtered and every string scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? FILTERED : scrubValue(inner, depth + 1);
  }
  return out;
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (HEADER_ALLOWLIST.has(key.toLowerCase()) && typeof value === "string") {
      out[key] = scrubString(value);
    }
  }
  return out;
}

type Loose = Record<string, unknown>;

/**
 * Scrubs a Sentry event (or transaction) in a copy. Typed loosely so the
 * same function serves every SDK entry point and stays unit-testable.
 */
export function scrubEvent<T extends object>(event: T): T {
  const copy = scrubValue(event) as Loose;
  const original = event as Loose;

  const request = original.request as Loose | undefined;
  if (request && typeof request === "object") {
    const next: Loose = {};
    if (typeof request.url === "string") next.url = scrubString(request.url);
    if (typeof request.method === "string") next.method = request.method;
    if (typeof request.query_string === "string") {
      next.query_string = scrubQuery(`?${request.query_string}`).slice(1);
    } else if (request.query_string) {
      next.query_string = scrubValue(request.query_string);
    }
    const headers = scrubHeaders(request.headers);
    if (headers) next.headers = headers;
    // Bodies, cookies and env are never sent.
    copy.request = next;
  }

  const user = original.user as Loose | undefined;
  if (user && typeof user === "object") {
    copy.user = typeof user.id === "string" || typeof user.id === "number" ? { id: user.id } : undefined;
  }
  if (copy.server_name !== undefined) delete copy.server_name;
  return copy as T;
}

/** Breadcrumbs go through the same rules; console and fetch crumbs included. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  return scrubValue(breadcrumb) as T;
}
