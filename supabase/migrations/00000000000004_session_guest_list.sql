-- Party guest list (2026-10-05): staff add phone numbers to a session in
-- the Console; a guest who signs in with one of them (SMS code) lands in
-- that party automatically. Numbers are encrypted (B12.5); the salted hash
-- is what the sign-in looks up.

create table public.session_guest_list (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  phone_hash text not null,
  phone_encrypted text not null,
  created_at timestamptz not null default now(),
  unique (session_id, phone_hash)
);
create index session_guest_list_phone_idx on public.session_guest_list (phone_hash);

-- Server-only: RLS on with no policies, and no client privileges at all.
alter table public.session_guest_list enable row level security;
revoke all on public.session_guest_list from anon, authenticated;
