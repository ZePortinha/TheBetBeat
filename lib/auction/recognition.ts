/**
 * Public recognition for winners (PURE). Guests choose how they appear —
 * their @ handle, a table ("Mesa 7") or anonymous (the default). Real
 * names never exist in the app, so they can never leak.
 *
 *   ≥ screenNameCents     the chosen label shows on the public screen
 *   ≥ announceCents       the DJ gives a shoutout on the mic (always)
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
 * The recognition a winning total earns. From the mic tier (150 € by
 * default) the DJ ALWAYS gives a shoutout (owner, 2026-10-11): the bid
 * panel promises it before paying, so there is no hourly cap. An
 * anonymous winner still gets it, without a name: the DJ dedicates the
 * moment, never a person.
 */
export function recognitionFor(
  totalCents: number,
  rules: Pick<AuctionConfig["recognition"], "screenNameCents" | "announceCents" | "specialMomentCents">,
): { level: RecognitionLevel; announce: boolean } {
  const level: RecognitionLevel =
    totalCents >= rules.specialMomentCents
      ? "special_moment"
      : totalCents >= rules.announceCents
        ? "announce"
        : totalCents >= rules.screenNameCents
          ? "screen"
          : "none";
  return { level, announce: level === "announce" || level === "special_moment" };
}
