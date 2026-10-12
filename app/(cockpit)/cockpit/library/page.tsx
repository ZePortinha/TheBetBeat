import { LibraryScreen } from "@/components/cockpit/library-screen";
import { resolveCockpitVenue } from "../_lib/session";

export const dynamic = "force-dynamic";

/** Biblioteca — the DJ's own songs, by artist, album and style. */
export default async function CockpitLibraryPage() {
  const venue = await resolveCockpitVenue("/cockpit/library");
  return <LibraryScreen venueId={venue?.id ?? null} venueName={venue?.name ?? null} />;
}
