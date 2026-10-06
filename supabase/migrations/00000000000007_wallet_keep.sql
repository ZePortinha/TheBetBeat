-- 2026-10-05 — Slot auctions: the guest chooses what happens to the
-- wallet balance left at the end of the night: back to the payment method
-- (default) or kept in the app for another night at the same club. Only
-- honoured when the club allows it (auction config wallet.keepAllowed),
-- which stays off until the legal check on stored balances.

create table public.wallet_preferences (
  guest_id uuid not null references public.guests (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  keep_balance boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (guest_id, venue_id)
);

-- Server-only, like the rest of the wallet.
alter table public.wallet_preferences enable row level security;
revoke all on public.wallet_preferences from anon, authenticated;
