import "server-only";

/**
 * In-process idempotency memo for cockpit actions (B7 "chave de
 * idempotência em cada ação").
 *
 * The domain layer is the real guarantee: transitions are serialized on
 * the request row and a repeated event on the same state is rejected,
 * and money moves exactly once (lib/payments idempotency keys). This
 * memo only makes a RETRY of the same client action (offline replay,
 * double network submit) return the ORIGINAL response instead of a
 * confusing `invalid_transition` error. Process-local by design.
 */

interface MemoEntry {
  at: number;
  status: number;
  body: unknown;
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 1000;

const globalForMemo = globalThis as unknown as {
  __betbeatIdemMemo?: Map<string, MemoEntry>;
};

function store(): Map<string, MemoEntry> {
  if (!globalForMemo.__betbeatIdemMemo) {
    globalForMemo.__betbeatIdemMemo = new Map();
  }
  return globalForMemo.__betbeatIdemMemo;
}

/** Key is scoped by user so one staff's key can never replay another's. */
export function idempotencyKeyFor(
  userId: string,
  action: string,
  headerKey: string | null,
): string | null {
  if (!headerKey || headerKey.length === 0 || headerKey.length > 128) return null;
  return `${userId}:${action}:${headerKey}`;
}

export function recallIdempotent(key: string | null, now: number): MemoEntry | null {
  if (!key) return null;
  const memo = store();
  const hit = memo.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    memo.delete(key);
    return null;
  }
  return hit;
}

export function memoizeIdempotent(
  key: string | null,
  status: number,
  body: unknown,
  now: number,
): void {
  if (!key) return;
  const memo = store();
  if (memo.size >= MAX_ENTRIES) {
    // Drop the oldest entries (Map preserves insertion order).
    for (const old of memo.keys()) {
      memo.delete(old);
      if (memo.size < MAX_ENTRIES) break;
    }
  }
  memo.set(key, { at: now, status, body });
}
