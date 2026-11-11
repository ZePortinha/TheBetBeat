-- 2026-11-11 — Native app push (Capacitor shell, docs/APP-LOJAS.md).
-- The App Store / Play builds cannot use web push inside their WebView, so
-- each device registers its APNs (iOS) or FCM (Android) token instead. Same
-- shape and rules as push_subscriptions (0011): one row per device, the
-- token is the identity, url_path is the guest app a tap opens.
-- Numbered 22 to leave 21 to the Phase 8 branch (realtime board channel).

create table public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  token text not null unique check (char_length(token) between 32 and 4096),
  url_path text not null,
  created_at timestamptz not null default now()
);

create index native_push_tokens_guest_idx on public.native_push_tokens (guest_id);

-- Server-only: the API writes it, the auction engine reads it.
alter table public.native_push_tokens enable row level security;
revoke all on public.native_push_tokens from anon, authenticated;
