import { describe, expect, it } from "vitest";
import { DEFAULT_AUCTION_CONFIG, parseAuctionConfig } from "./config";
import { phaseAt, planNight } from "./schedule";
import { localParts, nextWallClock } from "./time";

const TZ = "Europe/Lisbon";
// Friday 2 Oct 2026, 23:00 → Saturday 06:00 Lisbon (WEST, UTC+1).
const OPEN = Date.UTC(2026, 9, 2, 22, 0);
const END = Date.UTC(2026, 9, 3, 5, 0);
const lisbon = (ms: number) => {
  const p = localParts(ms, TZ);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("local time across midnight", () => {
  it("maps a phase time to the first occurrence after the opening", () => {
    expect(nextWallClock(OPEN, "02:00", TZ)).toBe(Date.UTC(2026, 9, 3, 1, 0)); // next day
    expect(nextWallClock(OPEN, "23:30", TZ)).toBe(Date.UTC(2026, 9, 2, 22, 30)); // same day
    expect(nextWallClock(OPEN, "23:00", TZ)).toBe(OPEN); // exactly now counts
  });

  it("follows the October clock change (02:00 WEST → 01:00 WET)", () => {
    const open = Date.UTC(2026, 9, 24, 22, 0); // Sat 24 Oct, 23:00 WEST
    expect(nextWallClock(open, "00:30", TZ)).toBe(Date.UTC(2026, 9, 24, 23, 30)); // still WEST
    expect(nextWallClock(open, "03:00", TZ)).toBe(Date.UTC(2026, 9, 25, 3, 0)); // WET (UTC+0)
  });
});

describe("planNight (club defaults)", () => {
  const plan = planNight(OPEN, END, DEFAULT_AUCTION_CONFIG);
  const closes = plan.slots.map((s) => `${lisbon(s.closesAtMs)} ${s.kind}/${s.phase}`);

  it("plans no auction in the warm-up and spreads slots per phase", () => {
    expect(closes).toEqual([
      "01:00 regular/ramp",
      "01:30 regular/ramp",
      "02:00 first_peak/peak",
      "02:15 regular/peak",
      "02:30 regular/peak",
      "02:45 regular/peak",
      "03:00 regular/peak",
      "03:15 regular/peak",
      "03:30 regular/peak",
      "03:45 regular/peak",
      "04:00 regular/close",
      "04:30 regular/close",
      "05:00 regular/close",
      "05:30 regular/close",
      "05:45 last_song/close",
    ]);
  });

  it("opens regular auctions 4 min before the close and specials 30 min before, at their own price", () => {
    const regular = plan.slots.find((s) => s.kind === "regular" && s.phase === "peak")!;
    expect(regular.closesAtMs - regular.opensAtMs).toBe(4 * 60_000);
    expect(regular.minPriceCents).toBe(500);
    expect(plan.slots.find((s) => s.phase === "ramp")!.minPriceCents).toBe(200);
    for (const special of plan.slots.filter((s) => s.kind !== "regular")) {
      expect(special.closesAtMs - special.opensAtMs).toBe(30 * 60_000);
      expect(special.minPriceCents).toBe(1000);
    }
  });

  it("opens the night's first auction at the opening: the longest one", () => {
    const [first, second] = plan.slots;
    expect(first!.opensAtMs).toBe(OPEN); // 23:00 → 01:00
    expect(second!.closesAtMs - second!.opensAtMs).toBe(4 * 60_000);
    const off = planNight(OPEN, END, parseAuctionConfig({ firstAuctionFromStart: false }));
    expect(off.slots[0]!.closesAtMs - off.slots[0]!.opensAtMs).toBe(4 * 60_000);
  });

  it("stays under 15% of the night's songs, and says so when it would not", () => {
    expect(plan).toMatchObject({ estimatedSongs: 126, maxSlots: 18, withinCap: true });
    const slowDj = planNight(OPEN, END, parseAuctionConfig({ songsPerHour: 6 }));
    expect(slowDj.withinCap).toBe(false);
  });

  it("knows the phase at any moment, and nothing outside the night", () => {
    expect(phaseAt(OPEN + 30 * 60_000, OPEN, END, DEFAULT_AUCTION_CONFIG)).toBe("warmup");
    expect(phaseAt(Date.UTC(2026, 9, 3, 2, 10), OPEN, END, DEFAULT_AUCTION_CONFIG)).toBe("peak"); // 03:10
    expect(phaseAt(END, OPEN, END, DEFAULT_AUCTION_CONFIG)).toBeNull();
  });

  it("handles a night that opens after midnight and skips specials outside it", () => {
    const open = Date.UTC(2026, 9, 3, 1, 30); // 02:30 local: peak already running
    const late = planNight(open, END, DEFAULT_AUCTION_CONFIG);
    expect(late.slots.every((s) => s.closesAtMs >= open)).toBe(true);
    expect(late.slots.some((s) => s.kind === "first_peak")).toBe(false); // 02:00 already gone
    expect(lisbon(late.slots[0]!.closesAtMs)).toBe("02:30");
  });

  it("can turn specials off", () => {
    const noSpecials = planNight(
      OPEN,
      END,
      parseAuctionConfig({ specials: { firstPeak: { enabled: false }, lastSong: { enabled: false } } }),
    );
    expect(noSpecials.slots.every((s) => s.kind === "regular")).toBe(true);
    expect(noSpecials.slots.map((s) => lisbon(s.closesAtMs))).toContain("02:00");
  });
});
