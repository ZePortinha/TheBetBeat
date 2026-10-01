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

export interface CatalogProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<CatalogTrack[]>;
  getTrack(providerTrackId: string): Promise<CatalogTrack | null>;
}
