/**
 * Tiny per-process cache for PUBLIC, per-session reads that every phone in
 * the venue polls (session state, auction board). Within `ttlMs` all callers
 * share one result, and concurrent callers share one in-flight query, so a
 * full room (or a flood) costs one database read per key per interval.
 * Never use it for per-guest data.
 */
interface Entry<T> {
  at: number;
  value: Promise<T>;
}

export function createMicroCache<T>(ttlMs: number, maxKeys = 500) {
  const entries = new Map<string, Entry<T>>();
  return function cached(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    if (entries.size >= maxKeys) {
      for (const [k, e] of entries) if (now - e.at >= ttlMs) entries.delete(k);
      if (entries.size >= maxKeys) entries.clear();
    }
    const value = load();
    entries.set(key, { at: now, value });
    // A failure is not cached: the next caller tries again.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
}
