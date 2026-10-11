import { describe, expect, it } from "vitest";
import { createWinScene } from "@/components/guest/win-scene";

/** A 2D context that records every call and property write. */
function recordingContext(log: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: (o: number, c: string) => log.push(`stop ${o} ${c}`) };
  return new Proxy({} as Record<string, unknown>, {
    get(_, key: string) {
      if (key === "measureText") return (s: string) => ({ width: s.length * 10 });
      if (key.startsWith("create")) return (...args: unknown[]) => (log.push(`${key} ${args.join(",")}`), gradient);
      return (...args: unknown[]) => log.push(`${key}(${args.map((a) => (typeof a === "number" ? a.toFixed(3) : String(a))).join(",")})`);
    },
    set(_, key: string, value: unknown) {
      log.push(`${key}=${String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const text = {
  eyebrow: "Leilão fechado",
  title: "Vencedor",
  amount: "12 €",
  trackTitle: "Midnight Circuit",
  trackArtist: "Kova Ray",
  brand: "BetBeat × Club Meridiano",
  footer: "qui · 8 out · 01:24",
};

describe("win scene", () => {
  it("paints the same frame for the same time (the video matches the screen)", () => {
    for (const t of [0, 0.4, 0.75, 1.6, 4.2, 9]) {
      const a: string[] = [];
      const b: string[] = [];
      createWinScene({ text }).draw(recordingContext(a), 720, 1280, t);
      createWinScene({ text }).draw(recordingContext(b), 720, 1280, t);
      expect(a.length).toBeGreaterThan(100);
      expect(a).toEqual(b);
    }
  });

  it("moves between frames and never paints NaN", () => {
    const scene = createWinScene({ lite: true });
    const one: string[] = [];
    const two: string[] = [];
    scene.draw(recordingContext(one), 393, 852, 1.2);
    scene.draw(recordingContext(two), 393, 852, 1.25);
    expect(one).not.toEqual(two);
    expect([...one, ...two].some((line) => line.includes("NaN"))).toBe(false);
  });
});
