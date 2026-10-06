-- 2026-10-06 — Real music catalog (Deezer) + transition assistant.
--
-- * public.tracks is the global catalog cache: where a BPM came from
--   ('catalog' = the provider, 'audio' = measured from the 30 s preview)
--   and when we last tried, so a track without a measurable pulse is not
--   re-analysed on every search.
-- * Bids can be for a catalog track (catalog_track_id) instead of a track
--   of the club's library; the transition difficulty and its price
--   multiplier are snapshotted when the bid is made.
-- * New nights open the full catalog by default (the DJ can still switch a
--   night to "Só biblioteca" in the cockpit).

alter table public.tracks add column bpm_source text check (bpm_source in ('catalog', 'audio'));
alter table public.tracks add column bpm_checked_at timestamptz;

alter table public.auction_bids add column catalog_track_id uuid references public.tracks (id);
alter table public.auction_bids add column transition text
  check (transition in ('easy', 'medium', 'hard', 'unknown'));

alter table public.sessions alter column catalog_mode set default 'library_plus_catalog';

-- A bid waiting for its MB WAY / card money can be for a catalog track too.
alter table public.auction_intents add column catalog_track_id uuid references public.tracks (id);

-- Tracks a guest saw near the top of a search: the worker measures their
-- BPM in the background (never inside the search request).
alter table public.tracks add column bpm_wanted_at timestamptz;
create index tracks_bpm_wanted_idx on public.tracks (bpm_wanted_at)
  where bpm is null and bpm_checked_at is null and bpm_wanted_at is not null;
