-- Guest sign-in with a phone number + SMS code (2026-10-05).
-- Optional: guests still pay without it (B1/B4 #3). A verified number is
-- kept encrypted in guests.phone_encrypted and pre-fills MB WAY.

alter table public.guests add column phone_verified_at timestamptz;

-- One row per code sent. Only hashes are stored: the number is in
-- phone_hash (salted, B12.5) and the code is an HMAC, never in clear.
create table public.guest_phone_codes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id) on delete cascade,
  phone_hash text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index guest_phone_codes_guest_idx
  on public.guest_phone_codes (guest_id, created_at desc);

-- Server-only: RLS on with no policies, and no client privileges at all.
alter table public.guest_phone_codes enable row level security;
revoke all on public.guest_phone_codes from anon, authenticated;
