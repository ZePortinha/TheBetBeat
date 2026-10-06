-- 2026-10-06 — Durable rate limits (B12.4).
-- The in-memory limiter (lib/security/rate-limit.ts) is per process: on a
-- host that runs several instances, each one keeps its own count. Limits
-- that guard against password guessing are counted here instead, one
-- fixed-window counter per key (lib/security/rate-limit-pg.ts).

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

create index rate_limits_window_idx on public.rate_limits (window_start);

-- Server only.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
