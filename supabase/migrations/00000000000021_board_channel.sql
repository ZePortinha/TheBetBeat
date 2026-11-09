-- Auction board channel (Phase 8 load test, docs/LOAD-TEST.md).
-- session:<id>:board carries the PUBLIC auction board, written only by the
-- server (service role, broadcast API). There is no insert policy, so no
-- client can broadcast on it; any signed-in guest (anonymous guests are
-- `authenticated`) may listen, because everything on it is public data the
-- guest API already returns to every phone.
create policy board_broadcasts on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'session:%:board');
