-- 2026-10-11: the DJ's own library, the event's music criteria, the
-- promoter's share and the fixed 11% platform fee.
--
-- * library_tracks gains album, year and a cover so the DJ can build and
--   browse the library by artist, album and style (genre).
-- * sessions gain an optional BPM range; with the event's styles
--   (sessions.genres) it decides what guests are shown first.
-- * session_settings gain the promoter's share (bps of what is left after
--   the platform fee, like venue_share_bps) and the promoter's name. The
--   DJ keeps the rest. Payouts can now go to the promoter.
-- * Ritma's fee is a flat 11% of every event (was a per-venue contract).
--   Events already created keep the fee they were planned with.

alter table public.library_tracks
  add column album text check (char_length(album) <= 120),
  add column year int check (year between 1900 and 2100),
  add column cover_url text check (char_length(cover_url) <= 500),
  add column catalog_track_id uuid references public.tracks (id) on delete set null;
create index library_tracks_venue_artist_idx on public.library_tracks (venue_id, lower(artist));
create index library_tracks_venue_genre_idx on public.library_tracks (venue_id, lower(genre));

alter table public.sessions
  add column bpm_min int check (bpm_min between 40 and 220),
  add column bpm_max int check (bpm_max between 40 and 220),
  add constraint sessions_bpm_range_chk check (bpm_min is null or bpm_max is null or bpm_min <= bpm_max);

alter table public.session_settings
  add column promoter_share_bps int not null default 0 check (promoter_share_bps between 0 and 10000),
  add column promoter_name text check (char_length(promoter_name) <= 80),
  add constraint session_settings_shares_chk check (venue_share_bps + promoter_share_bps <= 10000);

alter table public.payouts drop constraint payouts_recipient_type_check;
alter table public.payouts add constraint payouts_recipient_type_check
  check (recipient_type in ('venue', 'dj', 'promoter'));

alter table public.venues alter column betbeat_fee_bps set default 1100;
update public.venues set betbeat_fee_bps = 1100 where betbeat_fee_bps <> 1100;
