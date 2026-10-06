-- Slot auctions (2026-10-05) replace the QUEUE/SOON/NEXT tiers.
-- Rules live in lib/auction (pure); this is the data they act on.
-- Money model: every bid is CHARGED; the guest's money lives in a
-- per-venue wallet (guest_escrow in the ledger). Outbid money goes back
-- to the wallet at once; what is left at the end of the night is refunded
-- to the original payment method.

-- Club config defaults live in venues.settings->'auction'; each night
-- keeps the snapshot it was planned with.
alter table public.sessions add column auction_config jsonb;

create table public.auction_slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  venue_id uuid not null references public.venues (id),
  kind text not null check (kind in ('regular', 'first_peak', 'last_song')),
  phase text not null,
  opens_at timestamptz not null,
  scheduled_close_at timestamptz not null,
  -- Moves with soft close (never past scheduled_close_at + max extra).
  closes_at timestamptz not null,
  min_price_cents int not null check (min_price_cents >= 0),
  extensions int not null default 0,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'open', 'paused', 'cancelled', 'closed')),
  outcome text check (outcome in ('won', 'no_winner')),
  winning_bid_id uuid,
  -- The winner's track after the close (DJ panel).
  play_status text check (play_status in ('locked', 'accepted', 'playing', 'played', 'refunded')),
  refund_reason text check (refund_reason in ('rejected_by_dj', 'not_played', 'session_ended')),
  recognition text check (recognition in ('none', 'screen', 'announce', 'special_moment')),
  announce boolean not null default false,
  closed_at timestamptz,
  accepted_at timestamptz,
  playing_at timestamptz,
  played_at timestamptz,
  refunded_at timestamptz,
  announced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, scheduled_close_at)
);
create index auction_slots_session_idx on public.auction_slots (session_id, closes_at);
create index auction_slots_status_idx on public.auction_slots (status, opens_at);

create table public.auction_bids (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.auction_slots (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  venue_id uuid not null references public.venues (id),
  owner_guest_id uuid not null references public.guests (id),
  -- Track snapshot, fixed per bidder per slot.
  library_track_id uuid references public.library_tracks (id),
  track_title text not null,
  track_artist text not null,
  track_genre text,
  track_bpm numeric,
  track_key text,
  track_duration_sec int,
  -- Money currently behind this bid (0 once outbid: it went back).
  total_cents int not null default 0 check (total_cents >= 0),
  display_mode text not null default 'anonymous'
    check (display_mode in ('anonymous', 'handle', 'table')),
  display_label text check (char_length(display_label) <= 40),
  status text not null default 'leading'
    check (status in ('leading', 'outbid', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, owner_guest_id)
);
create index auction_bids_slot_idx on public.auction_bids (slot_id, status);
-- At most one leading bid per slot (the service keeps it; this backs it).
create unique index auction_bids_one_leader_idx on public.auction_bids (slot_id)
  where status = 'leading';

alter table public.auction_slots
  add constraint auction_slots_winning_bid_fk
  foreign key (winning_bid_id) references public.auction_bids (id);

-- Every accepted bid action: money a guest put behind a bid (their own or
-- someone else's). Returned → back in the wallet; spent → the track played.
create table public.auction_contributions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.auction_bids (id) on delete cascade,
  slot_id uuid not null references public.auction_slots (id) on delete cascade,
  guest_id uuid not null references public.guests (id),
  amount_cents int not null check (amount_cents > 0),
  -- The bid's total right after this action (metrics: price path).
  total_after_cents int not null,
  extended boolean not null default false,
  returned_at timestamptz,
  spent_at timestamptz,
  created_at timestamptz not null default now()
);
create index auction_contributions_bid_idx on public.auction_contributions (bid_id);
create index auction_contributions_guest_idx on public.auction_contributions (guest_id, created_at);

-- A bid waiting for its money (MB WAY push out, card being charged).
create table public.auction_intents (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.auction_slots (id) on delete cascade,
  guest_id uuid not null references public.guests (id),
  -- Own bid on this track, or backing another bid.
  library_track_id uuid references public.library_tracks (id),
  backed_bid_id uuid references public.auction_bids (id),
  target_total_cents int not null check (target_total_cents > 0),
  display_mode text not null default 'anonymous',
  display_label text,
  status text not null default 'pending'
    check (status in ('pending', 'placed', 'superseded', 'failed')),
  reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index auction_intents_guest_idx on public.auction_intents (guest_id, created_at desc);

-- Per-guest, per-venue wallet (sub-ledger of guest_escrow). Balance =
-- sum(amount_cents). Spent money never comes back, so it simply stays out.
create table public.wallet_entries (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues (id),
  guest_id uuid not null references public.guests (id),
  session_id uuid references public.sessions (id),
  amount_cents int not null check (amount_cents <> 0),
  reason text not null check (reason in ('topup', 'bid', 'bid_returned', 'refund')),
  contribution_id uuid references public.auction_contributions (id),
  payment_id uuid references public.payments (id),
  refund_id uuid references public.refunds (id),
  created_at timestamptz not null default now()
);
create index wallet_entries_guest_idx on public.wallet_entries (guest_id, venue_id);

-- Payments and refunds may now belong to a wallet top-up instead of a
-- request: they carry the session/venue themselves.
alter table public.payments alter column request_id drop not null;
alter table public.payments add column session_id uuid references public.sessions (id);
alter table public.payments add column venue_id uuid references public.venues (id);
alter table public.payments add column intent_id uuid references public.auction_intents (id);
alter table public.payments add constraint payments_owner_chk
  check (request_id is not null or (session_id is not null and venue_id is not null));
alter table public.refunds alter column request_id drop not null;
alter table public.refunds add column guest_id uuid references public.guests (id);

-- Server-only: RLS on with no policies, and no client privileges at all.
do $$
declare t text;
begin
  foreach t in array array[
    'auction_slots', 'auction_bids', 'auction_contributions', 'auction_intents', 'wallet_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Per-slot metrics (B: "comparar noites"): revenue, final price, bids,
-- distinct bidders, extensions, close → played delay, refunds and reason.
create view public.auction_slot_metrics with (security_invoker = true) as
select
  s.id as slot_id,
  s.session_id,
  s.venue_id,
  s.kind,
  s.phase,
  s.scheduled_close_at,
  s.closes_at,
  s.min_price_cents,
  s.status,
  s.outcome,
  s.play_status,
  s.refund_reason,
  s.extensions,
  wb.total_cents as final_price_cents,
  case when s.play_status = 'played' then wb.total_cents else 0 end as revenue_cents,
  coalesce(c.bids, 0) as bids,
  coalesce(c.bidders, 0) as bidders,
  case when s.played_at is not null and s.closed_at is not null
       then extract(epoch from (s.playing_at - s.closed_at))::int end as close_to_play_sec,
  s.recognition,
  s.announce
from public.auction_slots s
left join public.auction_bids wb on wb.id = s.winning_bid_id
left join lateral (
  select count(*)::int as bids, count(distinct guest_id)::int as bidders
    from public.auction_contributions where slot_id = s.id
) c on true;
revoke all on public.auction_slot_metrics from anon, authenticated;
