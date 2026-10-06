/**
 * CatalogProvider (B4.6): global catalog search with covers & 30s previews.
 * Mock until Phase 8. The DJ library import (rekordbox XML/CSV) is separate,
 * in lib/catalog/import.ts.
 */
export interface CatalogTrack {
  providerTrackId: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  camelotKey: string | null;
  durationSec: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
}

export interface CatalogAlbum {
  providerAlbumId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  trackCount: number | null;
}

export interface CatalogProvider {
  readonly name: string;
  /** One page of results (`offset` = how many to skip). */
  search(query: string, limit?: number, offset?: number): Promise<CatalogTrack[]>;
  getTrack(providerTrackId: string): Promise<CatalogTrack | null>;
  /** What people play most right now (when the provider has charts). */
  trending?(limit?: number): Promise<CatalogTrack[]>;
  /** Albums by name ("take care" → Drake's Take Care). */
  searchAlbums?(query: string, limit?: number): Promise<CatalogAlbum[]>;
  /** An album and every song on it, in order. */
  album?(providerAlbumId: string): Promise<{ album: CatalogAlbum; tracks: CatalogTrack[] } | null>;
}
