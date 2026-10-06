-- 2026-10-06 — Indexes for the busiest server queries.
-- Each of these ran as a sequential scan over a table that grows every night:
-- payment callbacks and the MB WAY poll (payments), the refund worker and
-- refund caps (refunds), wallet balances and top-up checks (wallet_entries),
-- and the end-of-night settlement (ledger_entries).

-- Webhooks and the status poll look payments up by the PSP reference.
create index payments_provider_ref_idx on public.payments (provider_ref);
-- Wallet refunds walk a guest's payments at a venue.
create index payments_guest_venue_idx on public.payments (guest_id, venue_id, created_at desc);
-- Worker: MB WAY pushes that expired here (deadlines) or may still be
-- approved (callback backup poll). Small partial indexes, open rows only.
create index payments_mbway_expiry_idx on public.payments (expires_at)
  where method = 'mbway' and status = 'pending';
create index payments_mbway_recent_idx on public.payments (created_at)
  where method = 'mbway' and status in ('pending', 'expired');

-- Refund caps and wallet refunds sum the refunds of one payment.
create index refunds_payment_idx on public.refunds (payment_id);
-- Refund worker: failed or stuck refunds only.
create index refunds_open_idx on public.refunds (updated_at)
  where status in ('failed', 'processing', 'pending');

-- "Was this top-up credited?" and end-of-night wallet sweeps.
create index wallet_entries_payment_idx on public.wallet_entries (payment_id)
  where payment_id is not null;
create index wallet_entries_session_idx on public.wallet_entries (session_id);

-- Settlement, payouts and the cockpit stats read one night's ledger.
create index ledger_session_idx on public.ledger_entries (session_id);
