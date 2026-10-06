-- NEXT battle (2026-10-05): until the DJ accepts it, the NEXT slot goes to
-- the highest offer. Several offers may be pending or paid in the same
-- transaction while the service resolves the battle under the session
-- lock, so the database backstop now guards the LOCKED slot: at most one
-- accepted or playing NEXT per session (B4.1 "só pode haver 1 ativo").

drop index public.requests_one_active_next_idx;
create unique index requests_one_active_next_idx on public.requests (session_id)
  where tier = 'NEXT' and status in ('accepted', 'playing');

-- When this request was last displaced from NEXT by a higher offer.
alter table public.requests add column outbid_at timestamptz;
