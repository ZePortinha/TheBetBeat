/**
 * Public recognition for winners (PURE). Guests choose how they appear —
 * their @ handle, a table ("Mesa 7") or anonymous (the default). Real
 * names never exist in the app, so they can never leak.
 *
 *   ≥ screenNameCents     the chosen label shows on the public screen
 *   ≥ announceCents       the DJ panel asks to announce it on the mic,
 *                         at most `announcementsPerHour` (then: screen only)
 *   ≥ specialMomentCents  "momento especial" cue for DJ and club (lights, CO2)
 */
import type { AuctionConfig } from "./config";

export type DisplayChoice =
  | { mode: "anonymous" }
  | { mode: "handle"; handle: string }
  | { mode: "table"; table: string };

/** What the screens print for a bidder; null = anonymous. */
export function displayLabel(choice: DisplayChoice): string | null {
  switch (choice.mode) {
    case "anonymous":
      return null;
    case "handle":
      return `@${choice.handle.replace(/^@/, "")}`;
    case "table":
      return choice.table;
  }
}

export type RecognitionLevel = "none" | "screen" | "announce" | "special_moment";

/**
 * The recognition a winning total earns, given the mic announcements
 * already made in the last hour (epoch ms). An anonymous winner is never
 * named: the screen shows the moment, never a person.
 */
export function recognitionFor(
  totalCents: number,
  anonymous: boolean,
  recentAnnouncementsMs: readonly number[],
  now: number,
  rules: AuctionConfig["recognition"],
): { level: RecognitionLevel; announce: boolean } {
  const level: RecognitionLevel =
    totalCents >= rules.specialMomentCents
      ? "special_moment"
      : totalCents >= rules.announceCents
        ? "announce"
        : totalCents >= rules.screenNameCents
          ? "screen"
          : "none";
  const wantsMic = level === "announce" || level === "special_moment";
  const announce = wantsMic && !anonymous && announcementsLeft(recentAnnouncementsMs, now, rules) > 0;
  return { level, announce };
}

/** Mic announcements still allowed in the rolling hour before `now`. */
export function announcementsLeft(
  recentAnnouncementsMs: readonly number[],
  now: number,
  rules: Pick<AuctionConfig["recognition"], "announcementsPerHour">,
): number {
  const used = recentAnnouncementsMs.filter((t) => t > now - 3_600_000 && t <= now).length;
  return Math.max(0, rules.announcementsPerHour - used);
}
