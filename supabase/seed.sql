-- BetBeat dev seed — ENTIRELY FICTIONAL data (BRIEF A2.5).
-- Staff logins (local dev only): password "betbeat-dev" for every account.

-- ── Auth users (staff) ──────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'dj.helix@betbeat.local',
   extensions.crypt('betbeat-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'dj.marrow@betbeat.local',
   extensions.crypt('betbeat-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'manager@betbeat.local',
   extensions.crypt('betbeat-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'admin@betbeat.local',
   extensions.crypt('betbeat-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@betbeat.local';

-- ── Venue, zones, staff ─────────────────────────────────────────────
insert into public.venues (id, name, slug)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Club Meridiano', 'club-meridiano');

insert into public.zones (id, venue_id, name, qr_slug)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Pista', 'zone-pista-dev'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bar', 'zone-bar-dev'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Mezzanine', 'zone-mezz-dev');

insert into public.staff (id, venue_id, user_id, role, display_name)
values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 'dj', 'DJ Helix'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222', 'dj', 'Marrow'),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
   '33333333-3333-4333-8333-333333333333', 'manager', 'Rita Gestora'),
  ('cccccccc-0000-4000-8000-000000000004', null,
   '44444444-4444-4444-8444-444444444444', 'admin', 'BetBeat Ops');

-- ── Active session (live now, for any dev run) ──────────────────────
insert into public.sessions (
  id, venue_id, dj_staff_id, name, status, genres, catalog_mode,
  starts_at, ends_at, display_slug
)
values (
  'dddddddd-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000001',
  'Noite Meridiano', 'live',
  array['house', 'afro house', 'deep house'],
  'library',
  now() - interval '1 hour', now() + interval '5 hours',
  'display-dev'
);

insert into public.session_settings (session_id, config)
values ('dddddddd-0000-4000-8000-000000000001', '{}'::jsonb);

-- ── Library: ~200 fictional tracks across genres ────────────────────
with genres(genre, bpm_lo, bpm_hi) as (
  values
    ('house', 120, 128), ('deep house', 118, 124), ('afro house', 118, 125),
    ('techno', 128, 140), ('melodic techno', 120, 126), ('disco', 110, 122),
    ('hip hop', 85, 100), ('r&b', 90, 105), ('drum & bass', 170, 176),
    ('pop remix', 100, 124)
),
adjectives(a, ai) as (
  select *, row_number() over () from (values
    ('Midnight'), ('Velvet'), ('Neon'), ('Solar'), ('Hidden'), ('Golden'),
    ('Electric'), ('Silent'), ('Crimson'), ('Lunar'), ('Wild'), ('Amber'),
    ('Phantom'), ('Coastal'), ('Iron'), ('Glass'), ('Nocturnal'), ('Radiant'),
    ('Deep'), ('Hollow')
  ) t(a)
),
nouns(n, ni) as (
  select *, row_number() over () from (values
    ('Circuit'), ('Horizon'), ('Pulse'), ('Mirage'), ('Avenue'), ('Tide'),
    ('Echo'), ('Garden'), ('Signal'), ('Harbour'), ('Motion'), ('Season'),
    ('Fever'), ('Static'), ('Corridor'), ('Bloom'), ('Voltage'), ('Drift'),
    ('Memory'), ('Skyline')
  ) t(n)
),
artists(artist, ri) as (
  select *, row_number() over () from (values
    ('Kova Ray'), ('Selma Dune'), ('Arco Verde'), ('Mina Flux'), ('Baltic Noir'),
    ('Juno Vale'), ('Oriel'), ('Casa Um'), ('Vesper Lane'), ('Tali Mar'),
    ('Rui Norte'), ('Elo Tinto'), ('Nata Sol'), ('Pedra Viva'), ('Ava Monte'),
    ('Linha Oito'), ('Soma Leste'), ('Brisa Real'), ('Furo'), ('Clave Sul')
  ) t(artist)
),
keys(k, ki) as (
  select *, row_number() over () from (values
    ('1A'),('2A'),('3A'),('4A'),('5A'),('6A'),('7A'),('8A'),('9A'),('10A'),
    ('11A'),('12A'),('1B'),('2B'),('3B'),('4B'),('5B'),('6B'),('7B'),('8B'),
    ('9B'),('10B'),('11B'),('12B')
  ) t(k)
),
numbered as (
  select g.genre, g.bpm_lo, g.bpm_hi,
         s.i,
         row_number() over (order by g.genre, s.i) as seq
  from genres g
  cross join generate_series(1, 20) as s(i)
)
insert into public.library_tracks
  (venue_id, title, artist, genre, bpm, camelot_key, duration_sec)
select
  'aaaaaaaa-0000-4000-8000-000000000001',
  a.a || ' ' || n.n,
  ar.artist,
  nb.genre,
  nb.bpm_lo + ((nb.seq * 7) % (nb.bpm_hi - nb.bpm_lo + 1)),
  k.k,
  150 + ((nb.seq * 13) % 210)
from numbered nb
join adjectives a on a.ai = 1 + ((nb.seq * 3) % 20)
join nouns n on n.ni = 1 + ((nb.seq * 11) % 20)
join artists ar on ar.ri = 1 + ((nb.seq * 5) % 20)
join keys k on k.ki = 1 + ((nb.seq * 17) % 24);

-- ── Set context: a few tracks already played tonight ────────────────
insert into public.session_tracks (session_id, title, artist, genre, bpm, camelot_key, duration_sec, source, started_at)
values
  ('dddddddd-0000-4000-8000-000000000001', 'Opening Tide', 'DJ Helix', 'deep house', 120, '8A', 300, 'dj', now() - interval '50 minutes'),
  ('dddddddd-0000-4000-8000-000000000001', 'Velvet Harbour', 'Kova Ray', 'house', 122, '9A', 320, 'dj', now() - interval '40 minutes'),
  ('dddddddd-0000-4000-8000-000000000001', 'Solar Motion', 'Mina Flux', 'afro house', 121, '8B', 340, 'dj', now() - interval '30 minutes'),
  ('dddddddd-0000-4000-8000-000000000001', 'Neon Garden', 'Juno Vale', 'house', 124, '9B', 330, 'dj', now() - interval '20 minutes'),
  ('dddddddd-0000-4000-8000-000000000001', 'Hidden Signal', 'Arco Verde', 'afro house', 123, '8A', 360, 'dj', now() - interval '8 minutes');

-- ── Genre multipliers start at 1.0 (B5.4) ───────────────────────────
insert into public.genre_multipliers (venue_id, genre, multiplier)
select 'aaaaaaaa-0000-4000-8000-000000000001', g, 1.0
from unnest(array[
  'house','deep house','afro house','techno','melodic techno','disco',
  'hip hop','r&b','drum & bass','pop remix'
]) as g;
