-- 2026-10-10 — Phone login and the runner-up rollover (owner's brief).
-- Numbered 17 so it never collides with PR #1's 13-16.
--
-- 1. A phone number IS the guest's account. The first guest (auth user)
--    that proves a number owns it; any other device that later proves the
--    same number is signed in as that guest (lib/guests/account.ts), so
--    the @, the balance and the history follow the number, not the phone.
--
-- 2. Runner-up rollover: whoever ends an auction in SECOND place has that
--    money moved automatically into the next auction as the opening bid
--    for the same track. Win it: spent as usual. Second again: it rolls
--    again. Third or lower: it is already back in the balance (it came
--    back when they were outbid), withdrawable for 7 days.

-- ── 1. Phone accounts ────────────────────────────────────────────────
create table public.phone_accounts (
  phone_hash text primary key,
  guest_id uuid not null unique references public.guests (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Numbers already proven keep the first guest that proved them.
insert into public.phone_accounts (phone_hash, guest_id)
select distinct on (phone_hash) phone_hash, id
  from public.guests
 where phone_hash is not null and phone_verified_at is not null
 order by phone_hash, phone_verified_at asc
on conflict do nothing;

alter table public.phone_accounts enable row level security;
revoke all on public.phone_accounts from anon, authenticated;

-- ── 2. Runner-up rollover ────────────────────────────────────────────
-- The bid's total the moment it was last outbid (total_cents drops to 0
-- then, because the money goes back): ranks the losers at the close.
alter table public.auction_bids add column last_total_cents int not null default 0
  check (last_total_cents >= 0);
alter table public.auction_bids add column last_outbid_at timestamptz;
-- A rolled bid remembers where it came from (the guest sees "transitou").
alter table public.auction_bids add column rolled_from_bid_id uuid references public.auction_bids (id);

-- One row per runner-up: the money is held out of the balance from the
-- close until it becomes the next auction's opening bid ('placed') or,
-- when that cannot happen, goes back to the balance ('released').
create table public.auction_rollovers (
  id uuid primary key default gen_random_uuid(),
  from_slot_id uuid not null unique references public.auction_slots (id) on delete cascade,
  from_bid_id uuid not null references public.auction_bids (id) on delete cascade,
  to_slot_id uuid references public.auction_slots (id) on delete set null,
  to_bid_id uuid references public.auction_bids (id) on delete set null,
  session_id uuid not null references public.sessions (id) on delete cascade,
  venue_id uuid not null references public.venues (id),
  owner_guest_id uuid not null references public.guests (id),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'held' check (status in ('held', 'placed', 'released')),
  release_reason text check (release_reason in (
    'no_next_auction', 'below_minimum', 'outbid_already', 'already_bidding', 'night_ended', 'track_unavailable'
  )),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index auction_rollovers_held_idx on public.auction_rollovers (to_slot_id) where status = 'held';
create index auction_rollovers_owner_idx on public.auction_rollovers (owner_guest_id, created_at desc);

-- Each contributor's share of a rollover (a backed bid rolls with its backers).
create table public.auction_rollover_shares (
  rollover_id uuid not null references public.auction_rollovers (id) on delete cascade,
  guest_id uuid not null references public.guests (id),
  amount_cents int not null check (amount_cents > 0),
  primary key (rollover_id, guest_id)
);

-- Wallet movements for the hold and its release.
alter table public.wallet_entries drop constraint wallet_entries_reason_check;
alter table public.wallet_entries add constraint wallet_entries_reason_check
  check (reason in ('topup', 'bid', 'bid_returned', 'refund', 'rollover_hold', 'rollover_released'));
alter table public.wallet_entries add column rollover_id uuid references public.auction_rollovers (id);
-- Balance expiry reads credits by date (7 days per euro, oldest first).
create index wallet_entries_credit_idx on public.wallet_entries (guest_id, venue_id, created_at)
  where amount_cents > 0;

-- Server-only, like the rest of the wallet.
alter table public.auction_rollovers enable row level security;
revoke all on public.auction_rollovers from anon, authenticated;
alter table public.auction_rollover_shares enable row level security;
revoke all on public.auction_rollover_shares from anon, authenticated;
