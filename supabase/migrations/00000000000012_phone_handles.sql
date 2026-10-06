-- 2026-10-06 — A phone number owns one @. The first time a number is
-- proven (SMS code, or an MB WAY payment approved in the app), it keeps the
-- guest's @; any device that later proves the same number gets that @ back,
-- and nobody else can use it. Keyed by the salted phone hash (B12.5: the
-- number itself never sits here).

create table public.phone_handles (
  phone_hash text primary key,
  handle text not null,
  created_at timestamptz not null default now()
);

create unique index phone_handles_handle_key on public.phone_handles (lower(handle));

-- Server-only, like the rest of the guest identity.
alter table public.phone_handles enable row level security;
revoke all on public.phone_handles from anon, authenticated;
