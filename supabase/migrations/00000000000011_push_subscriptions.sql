-- 2026-10-06 — Web push for guests: "someone outbid you" and "you are the
-- winner" reach the phone even with the app closed. One row per device
-- the guest enabled; the push service's endpoint is the identity. url_path
-- is the guest app the notification opens (/s/<qr token>).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  url_path text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_guest_idx on public.push_subscriptions (guest_id);

-- Server-only: the API writes it, the auction engine reads it.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
