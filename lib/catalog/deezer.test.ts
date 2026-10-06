import { describe, expect, it, vi } from "vitest";
import { CatalogUnavailableError, DeezerCatalogProvider } from "./deezer";

function deezer(responses: unknown[]) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 }));
  return { provider: new DeezerCatalogProvider(fetchImpl as unknown as typeof fetch, () => 1_000), fetchImpl };
}

const hit = {
  id: 3135553,
  title: "One More Time",
  duration: 320,
  preview: "https://cdnt-preview.dzcdn.net/x.mp3",
  artist: { name: "Daft Punk" },
  album: { cover_medium: "https://cdn-images.dzcdn.net/images/cover/x/250x250.jpg" },
};

describe("Deezer catalog", () => {
  it("maps search results and caches the query", async () => {
    const { provider, fetchImpl } = deezer([{ data: [hit] }]);
    const [track] = await provider.search("Daft Punk", 10);
    expect(track).toEqual({
      providerTrackId: "3135553",
      title: "One More Time",
      artist: "Daft Punk",
      genre: null,
      bpm: null,
      camelotKey: null,
      durationSec: 320,
      coverUrl: hit.album.cover_medium,
      previewUrl: hit.preview,
    });
    await provider.search("daft punk ", 10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads the BPM of a track, 0 meaning unknown", async () => {
    const { provider } = deezer([{ ...hit, bpm: 126.05 }, { ...hit, bpm: 0 }]);
    expect((await provider.getTrack("3135553"))?.bpm).toBe(126.1);
    expect((await provider.getTrack("3135553"))?.bpm).toBeNull();
    expect(await provider.getTrack("not-a-number")).toBeNull();
  });

  it("turns the quota error into an unavailable catalog", async () => {
    const { provider } = deezer([{ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }]);
    await expect(provider.search("anything")).rejects.toBeInstanceOf(CatalogUnavailableError);
  });
});
