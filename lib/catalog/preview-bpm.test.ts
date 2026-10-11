import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isPreviewUrl } = await import("./preview-bpm");

describe("isPreviewUrl", () => {
  it("accepts Deezer's preview CDN only", () => {
    expect(isPreviewUrl("https://cdnt-preview.dzcdn.net/api/1/1/a/b/0/abc.mp3?hdnea=x")).toBe(true);
    expect(isPreviewUrl("https://cdns-preview-d.dzcdn.net/stream/c-abc-3.mp3")).toBe(true);
  });

  it("refuses anything the server should never fetch", () => {
    for (const url of [
      "http://cdnt-preview.dzcdn.net/a.mp3",
      "https://cdnt-preview.dzcdn.net:8443/a.mp3",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/a.mp3",
      "https://dzcdn.net.evil.example/a.mp3",
      "https://evildzcdn.net/a.mp3",
      "not a url",
    ]) {
      expect(isPreviewUrl(url), url).toBe(false);
    }
  });
});
