/**
 * Deezer catalog adapter (2026-10-06) — the "full catalog" for guests.
 *
 * Public API, no key: https://api.deezer.com
 *   GET /search?q=&limit=  → { data: [{ id, title, duration, preview, artist{name}, album{cover_medium} }] }
 *   GET /track/{id}        → { …, bpm }   (bpm is 0 when Deezer does not know it)
 * Errors come back as HTTP 200 { error: { type, message, code } }; code 4 is
 * the quota (≈ 50 requests / 5 s per server IP). Search results are cached
 * in memory for 10 minutes so a full club does not burn the quota.
 * Production use must follow Deezer's API terms (attribution in the UI).
 */
import type { CatalogAlbum, CatalogProvider, CatalogTrack } from "./types";

const API = "https://api.deezer.com";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;

export class CatalogUnavailableError extends Error {}

interface DeezerTrack {
  id: number;
  title: string;
  duration?: number;
  preview?: string;
  bpm?: number;
  artist?: { name?: string };
  album?: { cover_medium?: string };
}

interface DeezerAlbum {
  id: number;
  title: string;
  nb_tracks?: number;
  cover_medium?: string;
  artist?: { name?: string };
}

function toAlbum(a: DeezerAlbum): CatalogAlbum {
  return {
    providerAlbumId: String(a.id),
    title: a.title,
    artist: a.artist?.name ?? "",
    coverUrl: a.cover_medium ?? null,
    trackCount: a.nb_tracks ?? null,
  };
}

function toTrack(t: DeezerTrack): CatalogTrack {
  return {
    providerTrackId: String(t.id),
    title: t.title,
    artist: t.artist?.name ?? "",
    genre: null,
    bpm: t.bpm && t.bpm > 0 ? Math.round(t.bpm * 10) / 10 : null,
    camelotKey: null,
    durationSec: t.duration ?? null,
    coverUrl: t.album?.cover_medium ?? null,
    previewUrl: t.preview || null,
  };
}

export class DeezerCatalogProvider implements CatalogProvider {
  readonly name = "deezer";
  // ponytail: per-instance cache; move to a shared cache when there are several app instances.
  private readonly cache = new Map<string, { at: number; tracks: CatalogTrack[] }>();
  private readonly albumCache = new Map<string, { at: number; albums: CatalogAlbum[] }>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new CatalogUnavailableError(`deezer: HTTP ${res.status}`);
    const body = (await res.json()) as T & { error?: { code?: number; message?: string } };
    if (body.error) throw new CatalogUnavailableError(`deezer: ${body.error.code ?? "?"} ${body.error.message ?? ""}`);
    return body;
  }

  async search(query: string, limit = 25, offset = 0): Promise<CatalogTrack[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const key = `${q}|${limit}|${offset}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.tracks;
    const body = await this.get<{ data?: DeezerTrack[] }>(
      `/search?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 50)}&index=${Math.max(0, offset)}`,
    );
    const tracks = (body.data ?? []).filter((t) => t.title && t.artist?.name).map(toTrack);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: this.now(), tracks });
    return tracks;
  }

  async trending(limit = 20): Promise<CatalogTrack[]> {
    const key = `chart|${limit}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.tracks;
    const body = await this.get<{ data?: DeezerTrack[] }>(`/chart/0/tracks?limit=${Math.min(limit, 50)}`);
    const tracks = (body.data ?? []).filter((t) => t.title && t.artist?.name).map(toTrack);
    this.cache.set(key, { at: this.now(), tracks });
    return tracks;
  }

  async searchAlbums(query: string, limit = 6): Promise<CatalogAlbum[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const key = `album|${q}|${limit}`;
    const hit = this.albumCache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.albums;
    const body = await this.get<{ data?: DeezerAlbum[] }>(`/search/album?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 25)}`);
    const albums = (body.data ?? []).filter((a) => a.title && a.artist?.name).map(toAlbum);
    if (this.albumCache.size >= CACHE_MAX) this.albumCache.delete(this.albumCache.keys().next().value!);
    this.albumCache.set(key, { at: this.now(), albums });
    return albums;
  }

  async album(providerAlbumId: string): Promise<{ album: CatalogAlbum; tracks: CatalogTrack[] } | null> {
    if (!/^\d+$/.test(providerAlbumId)) return null;
    const [meta, list] = await Promise.all([
      this.get<DeezerAlbum>(`/album/${providerAlbumId}`),
      this.get<{ data?: DeezerTrack[] }>(`/album/${providerAlbumId}/tracks?limit=200`),
    ]);
    const album = toAlbum(meta);
    // Album track lists carry no cover: use the album's.
    const tracks = (list.data ?? [])
      .filter((t) => t.title)
      .map((t) => ({ ...toTrack(t), artist: t.artist?.name ?? album.artist, coverUrl: album.coverUrl }));
    return { album, tracks };
  }

  async getTrack(providerTrackId: string): Promise<CatalogTrack | null> {
    if (!/^\d+$/.test(providerTrackId)) return null;
    try {
      return toTrack(await this.get<DeezerTrack>(`/track/${providerTrackId}`));
    } catch {
      return null;
    }
  }
}
