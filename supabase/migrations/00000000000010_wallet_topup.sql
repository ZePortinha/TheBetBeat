-- 2026-10-06 — "Carregar saldo": a guest loads their balance before
-- bidding, so every bid is instant (an MB WAY push takes 30-60 s). Same
-- path as a bid's top-up (intent → payment → wallet), just without a bid:
-- no slot, no target, and the intent ends 'credited' when the money lands.

alter table public.auction_intents alter column slot_id drop not null;
alter table public.auction_intents alter column target_total_cents drop not null;
alter table public.auction_intents drop constraint auction_intents_status_check;
alter table public.auction_intents
  add constraint auction_intents_status_check
  check (status in ('pending', 'placed', 'superseded', 'failed', 'credited'));
-- A bid intent always has its slot and target; a balance top-up has neither.
alter table public.auction_intents
  add constraint auction_intents_kind_check
  check ((slot_id is null) = (target_total_cents is null));
