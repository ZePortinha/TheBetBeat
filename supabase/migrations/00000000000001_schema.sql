-- BetBeat schema (BRIEF B11 "Dados"). Money: integer cents. Dates: UTC.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ── Enums ───────────────────────────────────────────────────────────
create type public.request_tier as enum ('QUEUE', 'SOON', 'NEXT');
create type public.request_status as enum (
  'pending_payment', 'paid', 'accepted', 'playing', 'played', 'expired', 'refunded'
);
create type public.close_reason as enum (
  'payment_timeout', 'rejected_by_dj', 'dj_timeout', 'cancelled_by_dj', 'session_ended'
);
create type public.staff_role as enum ('dj', 'manager', 'admin');
create type public.session_status as enum ('scheduled', 'live', 'paused', 'ended');
create type public.payment_method as enum ('mbway', 'card', 'apple_pay', 'google_pay');
create type public.payment_status as enum (
  'pending', 'authorized', 'captured', 'voided', 'failed', 'expired'
);
create type public.refund_status as enum ('pending', 'processing', 'succeeded', 'failed');
create type public.payout_status as enum ('pending', 'processing', 'paid', 'failed');
create type public.catalog_mode as enum ('library', 'library_plus_catalog');

-- ── Organisation ────────────────────────────────────────────────────
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Europe/Lisbon',
  currency text not null default 'EUR',
  betbeat_fee_bps int not null default 2000 check (betbeat_fee_bps between 0 and 5000),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  -- Opaque id embedded in the signed QR token; the HMAC lives in the token itself.
  qr_slug text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  -- venue_id NULL = platform-level BetBeat admin.
  venue_id uuid references public.venues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.staff_role not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (venue_id, user_id),
  constraint platform_admin_only_null_venue check (venue_id is not null or role = 'admin')
);
create index staff_user_idx on public.staff (user_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  dj_staff_id uuid references public.staff (id),
  name text not null,
  status public.session_status not null default 'scheduled',
  genres text[] not null default '{}',
  catalog_mode public.catalog_mode not null default 'library',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ended_at timestamptz,
  requests_open boolean not null default true,
  -- Signed display token slug for /display/[token].
  display_slug text not null unique default encode(gen_random_bytes(9), 'hex'),
  -- Last published pricing factors (B5.6 smoothing).
  last_demand_factor numeric,
  last_occupancy_factor numeric,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index sessions_venue_idx on public.sessions (venue_id, status);

create table public.session_settings (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  -- Full SessionConfig (lib/domain/types.ts). Defaults applied server-side.
  config jsonb not null default '{}'::jsonb,
  -- Venue/DJ split of the post-fee remainder, bps of that remainder.
  venue_share_bps int not null default 5000 check (venue_share_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);

-- ── Catalog ─────────────────────────────────────────────────────────
create table public.library_tracks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  title text not null,
  artist text not null,
  genre text not null,
  bpm numeric,
  camelot_key text,
  duration_sec int,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);
create index library_tracks_venue_idx on public.library_tracks (venue_id);
create index library_tracks_search_idx on public.library_tracks
  using gin ((title || ' ' || artist) gin_trgm_ops);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_track_id text not null,
  title text not null,
  artist text not null,
  genre text,
  bpm numeric,
  camelot_key text,
  duration_sec int,
  cover_url text,
  preview_url text,
  created_at timestamptz not null default now(),
  unique (provider, provider_track_id)
);

-- Tracks actually played during a session (no-repeat window, set fit context).
create table public.session_tracks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  request_id uuid, -- fk added after requests exists
  title text not null,
  artist text not null,
  genre text,
  bpm numeric,
  camelot_key text,
  duration_sec int,
  source text not null default 'request' check (source in ('request', 'dj')),
  started_at timestamptz not null default now()
);
create index session_tracks_session_idx on public.session_tracks (session_id, started_at desc);

-- ── Guests & requests ───────────────────────────────────────────────
create table public.guests (
  -- Primary key IS the anonymous auth uid (Supabase Anonymous Sign-ins).
  id uuid primary key references auth.users (id) on delete cascade,
  handle text,
  ranking_optin boolean not null default false,
  sms_optin boolean not null default false,
  locale text not null default 'pt-PT',
  -- Sensitive data encrypted at rest (B12.5); hash is salted, for limits only.
  phone_encrypted text,
  phone_hash text,
  email_encrypted text,
  created_at timestamptz not null default now()
);
create index guests_phone_hash_idx on public.guests (phone_hash);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  zone_id uuid references public.zones (id),
  guest_id uuid not null references public.guests (id),
  library_track_id uuid references public.library_tracks (id),
  track_id uuid references public.tracks (id),
  track_title text not null,
  track_artist text not null,
  track_genre text,
  fit_score numeric not null,
  fit_label text not null,
  demand_rho numeric not null,
  tiers jsonb not null,
  breakdown jsonb not null,
  expires_at timestamptz not null,
  converted boolean not null default false,
  created_at timestamptz not null default now(),
  check (library_track_id is not null or track_id is not null)
);
create index quotes_session_idx on public.quotes (session_id, created_at desc);
create index quotes_guest_idx on public.quotes (guest_id);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  session_id uuid not null references public.sessions (id),
  zone_id uuid references public.zones (id),
  guest_id uuid not null references public.guests (id),
  quote_id uuid not null references public.quotes (id),
  -- Track snapshot (stable even if the library changes).
  library_track_id uuid references public.library_tracks (id),
  track_id uuid references public.tracks (id),
  track_title text not null,
  track_artist text not null,
  track_genre text,
  track_bpm numeric,
  track_key text,
  track_duration_sec int,
  cover_url text,
  in_library boolean not null default true,
  fit_score numeric,
  fit_label text,
  tier public.request_tier not null,
  amount_cents int not null check (amount_cents > 0),
  status public.request_status not null default 'pending_payment',
  close_reason public.close_reason,
  reject_reason text,
  message text check (char_length(message) <= 60),
  message_approved boolean not null default false,
  pinned_next boolean not null default false,
  sla_missed boolean not null default false,
  original_tier public.request_tier,
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  paid_at timestamptz,
  accepted_at timestamptz,
  playing_at timestamptz,
  played_at timestamptz,
  closed_at timestamptz,
  -- Promise deadline (SOON/NEXT); null for QUEUE (promise = end of set).
  deadline_at timestamptz,
  -- DJ decision window deadline (B4.1): refund if no decision by then.
  decision_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_session_status_idx on public.requests (session_id, status);
create index requests_guest_idx on public.requests (guest_id, created_at desc);
create index requests_deadline_idx on public.requests (deadline_at)
  where status in ('paid', 'accepted');
create index requests_decision_idx on public.requests (decision_deadline_at)
  where status = 'paid';
-- Only one active NEXT per session (B4.1) — belt to the transactional braces.
create unique index requests_one_active_next_idx on public.requests (session_id)
  where tier = 'NEXT' and status in ('pending_payment', 'paid', 'accepted', 'playing');

alter table public.session_tracks
  add constraint session_tracks_request_fk
  foreign key (request_id) references public.requests (id);

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  from_status public.request_status,
  to_status public.request_status not null,
  reason text,
  actor text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, created_at);

-- ── Money (server-only writes; see RLS migration) ───────────────────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id),
  guest_id uuid not null references public.guests (id),
  provider text not null,
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  amount_cents int not null check (amount_cents > 0),
  captured_cents int not null default 0 check (captured_cents >= 0),
  provider_ref text,
  idempotency_key text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_request_idx on public.payments (request_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  request_id uuid not null references public.requests (id),
  amount_cents int not null check (amount_cents > 0),
  reason text not null,
  status public.refund_status not null default 'pending',
  -- Exactly-once (B4.4): one refund per (request, reason).
  idempotency_key text not null unique,
  provider_ref text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_request_idx on public.refunds (request_id);

-- Double-entry immutable ledger (B4.5). Balances are always derived.
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  group_id uuid not null,
  account text not null,
  venue_id uuid references public.venues (id),
  session_id uuid references public.sessions (id),
  request_id uuid references public.requests (id),
  -- Signed cents: positive = debit, negative = credit. Each group sums to 0.
  amount_cents bigint not null check (amount_cents <> 0),
  memo text,
  created_at timestamptz not null default now()
);
create index ledger_group_idx on public.ledger_entries (group_id);
create index ledger_account_idx on public.ledger_entries (account, session_id);

create or replace function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'ledger_entries is immutable';
end;
$$;
create trigger ledger_immutable
  before update or delete on public.ledger_entries
  for each row execute function public.forbid_mutation();

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  venue_id uuid not null references public.venues (id),
  recipient_type text not null check (recipient_type in ('venue', 'dj')),
  staff_id uuid references public.staff (id),
  amount_cents bigint not null check (amount_cents >= 0),
  status public.payout_status not null default 'pending',
  provider_ref text,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id),
  guest_id uuid not null references public.guests (id),
  nif_encrypted text,
  amount_cents int not null,
  vat_rate numeric not null default 23,
  provider text not null default 'mock',
  provider_ref text,
  pdf_url text,
  status text not null default 'issued',
  created_at timestamptz not null default now()
);

-- ── Pricing ─────────────────────────────────────────────────────────
create table public.genre_multipliers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  genre text not null,
  multiplier numeric not null default 1.0 check (multiplier between 0.8 and 1.3),
  recommended numeric,
  metrics jsonb not null default '{}'::jsonb,
  auto_apply boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (venue_id, genre)
);

-- ── Audit ───────────────────────────────────────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  venue_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();
create trigger refunds_touch before update on public.refunds
  for each row execute function public.touch_updated_at();
create trigger payouts_touch before update on public.payouts
  for each row execute function public.touch_updated_at();
