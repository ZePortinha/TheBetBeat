/**
 * Local wall-clock ↔ UTC for club nights (Europe/Lisbon by default).
 * Nights cross midnight, so a phase time "02:00" means the FIRST 02:00
 * at or after the night opens. DST-aware via Intl, no dependency.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in `timeZone`. */
export function localParts(utcMs: number, timeZone: string) {
  const p = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const l = localParts(utcMs, timeZone);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - (utcMs - (utcMs % 1000));
}

/** Local date + time in `timeZone` → UTC ms (day may overflow: Date.UTC normalizes it). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset on both sides of a DST change.
  const first = naive - offsetMs(naive, timeZone);
  return naive - offsetMs(first, timeZone);
}

/**
 * Local noon of the night an opening belongs to: a club opening at 23:00
 * belongs to that day, one opening at 02:30 to the day before. Phase
 * times are read forward from here, so they keep their order even when
 * the doors open after a phase has started.
 */
export function nightAnchor(nightStartMs: number, timeZone: string): number {
  const p = localParts(nightStartMs, timeZone);
  return zonedToUtc(p.year, p.month, p.hour < 12 ? p.day - 1 : p.day, 12, 0, timeZone);
}

/** The first instant at or after `fromMs` whose local wall clock reads `hhmm`. */
export function nextWallClock(fromMs: number, hhmm: string, timeZone: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const day = localParts(fromMs, timeZone);
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidate = zonedToUtc(day.year, day.month, day.day + offset, h, m, timeZone);
    if (candidate >= fromMs) return candidate;
  }
  throw new Error(`no ${hhmm} within two days of ${new Date(fromMs).toISOString()}`);
}
