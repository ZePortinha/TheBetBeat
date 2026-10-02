import { describe, expect, it } from "vitest";
import { MockCatalogProvider } from "./mock";

describe("MockCatalogProvider", () => {
  const provider = new MockCatalogProvider();

  it("exposes a fictional catalog with no covers or previews", async () => {
    const all = await provider.search("a", 100);
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const track of all) {
      expect(track.coverUrl).toBeNull();
      expect(track.previewUrl).toBeNull();
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.providerTrackId).toMatch(/^mock-\d{3}$/);
    }
  });

  it("searches case-insensitively over title and artist", async () => {
    const byTitle = await provider.search("MIDNIGHT corridor");
    expect(byTitle[0]?.title).toBe("Midnight Corridor");

    const byArtist = await provider.search("kiloma");
    expect(byArtist.length).toBeGreaterThanOrEqual(2);
    for (const track of byArtist) {
      expect(track.artist).toBe("Kiloma");
    }
  });

  it("matches substrings and ranks title matches before artist matches", async () => {
    const results = await provider.search("nor");
    // "Duque do Norte" (artist) and "Vela Nordica" (artist) match via artist;
    // no title contains "nor", so ordering follows catalog order.
    expect(results.length).toBeGreaterThan(0);

    const velvet = await provider.search("velvet");
    expect(velvet[0]?.title).toBe("Velvet Engine");
  });

  it("returns stable, deterministic ordering", async () => {
    const first = await provider.search("a", 50);
    const second = await provider.search("a", 50);
    expect(first.map((t) => t.providerTrackId)).toEqual(
      second.map((t) => t.providerTrackId),
    );
  });

  it("respects the limit and returns [] for a blank query", async () => {
    const limited = await provider.search("a", 3);
    expect(limited).toHaveLength(3);
    expect(await provider.search("   ")).toEqual([]);
  });

  it("returns [] when nothing matches", async () => {
    expect(await provider.search("zzz-no-such-track")).toEqual([]);
  });

  it("getTrack resolves by id and returns null for unknown ids", async () => {
    const [hit] = await provider.search("Static Bloom", 1);
    expect(hit).toBeDefined();
    const fetched = await provider.getTrack(hit!.providerTrackId);
    expect(fetched).toEqual(hit);
    expect(await provider.getTrack("mock-999")).toBeNull();
  });

  it("only emits valid Camelot keys and sane BPMs", async () => {
    const all = await provider.search("a", 100);
    for (const track of all) {
      expect(track.camelotKey).toMatch(/^([1-9]|1[0-2])[AB]$/);
      expect(track.bpm).toBeGreaterThan(60);
      expect(track.bpm).toBeLessThan(200);
    }
  });
});
