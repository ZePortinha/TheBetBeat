/**
 * MockCatalogProvider (B4.6): a fictional global catalog used until Phase 8.
 * Covers and 30s previews are intentionally null — the UI must handle their
 * absence gracefully. All data is invented; no real artists or songs.
 */
import type { CatalogProvider, CatalogTrack } from "./types";

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEARCH_LIMIT = 100;

type SeedTrack = [
  title: string,
  artist: string,
  genre: string,
  bpm: number,
  camelotKey: string,
  durationSec: number,
];

/** ~40 fictional tracks with varied genres, BPM ranges and Camelot keys. */
const SEED_TRACKS: SeedTrack[] = [
  ["Midnight Corridor", "Vela Nordica", "Deep House", 122, "8A", 345],
  ["Glass Horizon", "Vela Nordica", "Deep House", 120, "7A", 312],
  ["Neon Tide", "Rua Oitava", "House", 124, "9B", 298],
  ["Paper Lanterns", "Rua Oitava", "House", 126, "10B", 275],
  ["Static Bloom", "Kiloma", "Techno", 132, "5A", 402],
  ["Iron Garden", "Kiloma", "Techno", 134, "6A", 388],
  ["Low Orbit", "Signal Verde", "Melodic Techno", 124, "11A", 421],
  ["Afterglow Protocol", "Signal Verde", "Melodic Techno", 123, "12A", 397],
  ["Velvet Engine", "The Marginal", "Indie Dance", 118, "4B", 263],
  ["Cold Coffee Dance", "The Marginal", "Indie Dance", 116, "3B", 241],
  ["Sal e Brisa", "Maré Alta", "Kizomba", 94, "6B", 256],
  ["Lua no Cais", "Maré Alta", "Kizomba", 90, "5B", 242],
  ["Passo Certo", "Bairro Leste", "Afro House", 121, "1A", 318],
  ["Terra Quente", "Bairro Leste", "Afro House", 123, "2A", 334],
  ["Golden Hour Riddim", "Ilha Nove", "Dancehall", 102, "7B", 212],
  ["Slow Bounce", "Ilha Nove", "Dancehall", 99, "8B", 198],
  ["Rooftop Confession", "Nina Travessa", "R&B", 88, "4A", 227],
  ["Silk Alarm", "Nina Travessa", "R&B", 92, "3A", 219],
  ["Chrome Hearts Club", "MC Horizonte", "Hip-Hop", 96, "9A", 203],
  ["Elevator Money", "MC Horizonte", "Hip-Hop", 84, "10A", 187],
  ["Cadência", "Duque do Norte", "Funk", 108, "2B", 195],
  ["Esquina Vibrante", "Duque do Norte", "Funk", 112, "1B", 208],
  ["Sunset Overdrive", "Praia Elétrica", "Pop", 114, "11B", 221],
  ["Carousel Nights", "Praia Elétrica", "Pop", 110, "12B", 234],
  ["Mirror Maze", "Octave Thief", "Electro", 128, "5A", 289],
  ["Voltage Lullaby", "Octave Thief", "Electro", 130, "6A", 301],
  ["Stratosphere Girl", "Aurora Quinta", "Trance", 138, "9A", 433],
  ["Second Sunrise", "Aurora Quinta", "Trance", 136, "8A", 418],
  ["Jump the Fence", "Barulho Fino", "Drum & Bass", 174, "3A", 311],
  ["Night Courier", "Barulho Fino", "Drum & Bass", 172, "2A", 296],
  ["Cereja no Topo", "Dona Vitrola", "Reggaeton", 95, "7A", 214],
  ["Calor da Pista", "Dona Vitrola", "Reggaeton", 97, "6A", 226],
  ["Disco Pirata", "Capitão Groove", "Disco", 118, "10B", 327],
  ["Roller Rink Romance", "Capitão Groove", "Disco", 120, "9B", 342],
  ["Amanhecer Dourado", "Tia Sintonia", "Amapiano", 113, "1A", 376],
  ["Log Drum Letter", "Tia Sintonia", "Amapiano", 112, "12A", 358],
  ["Breakbeat Bakery", "Forno 303", "Breaks", 135, "4A", 284],
  ["Acid Picnic", "Forno 303", "Acid House", 127, "5B", 307],
  ["Último Comboio", "Linha de Sintra", "Garage", 133, "11A", 269],
  ["Chuva de Verão", "Linha de Sintra", "UK Garage", 131, "12B", 252],
];

function buildCatalog(): CatalogTrack[] {
  return SEED_TRACKS.map(
    ([title, artist, genre, bpm, camelotKey, durationSec], index) => ({
      providerTrackId: `mock-${String(index + 1).padStart(3, "0")}`,
      title,
      artist,
      genre,
      bpm,
      camelotKey,
      durationSec,
      coverUrl: null,
      previewUrl: null,
    }),
  );
}

export class MockCatalogProvider implements CatalogProvider {
  readonly name = "mock";

  private readonly tracks: CatalogTrack[] = buildCatalog();
  private readonly byId = new Map<string, CatalogTrack>(
    this.tracks.map((t) => [t.providerTrackId, t]),
  );

  /**
   * Case-insensitive substring match over title + artist. Ordering is stable:
   * title matches rank before artist-only matches, and within each bucket the
   * fixed catalog order is preserved, so the same query always returns the
   * same list.
   */
  async search(query: string, limit?: number): Promise<CatalogTrack[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const max = Math.min(
      Math.max(1, Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT)),
      MAX_SEARCH_LIMIT,
    );

    const titleMatches: CatalogTrack[] = [];
    const artistMatches: CatalogTrack[] = [];
    for (const track of this.tracks) {
      if (track.title.toLowerCase().includes(q)) {
        titleMatches.push(track);
      } else if (track.artist.toLowerCase().includes(q)) {
        artistMatches.push(track);
      }
    }
    return [...titleMatches, ...artistMatches].slice(0, max);
  }

  async getTrack(providerTrackId: string): Promise<CatalogTrack | null> {
    return this.byId.get(providerTrackId) ?? null;
  }
}
