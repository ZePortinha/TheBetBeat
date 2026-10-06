-- 2026-10-06 — Slot auctions issue receipts too: when a winning track
-- plays, every guest whose money was spent on it gets one receipt for
-- their part. Rows are written in the same transaction as the money
-- (status 'pending') and issued by the worker afterwards (outbox), so a
-- crash between the commit and the invoicing provider never loses one.

alter table public.invoices alter column request_id drop not null;
alter table public.invoices add column auction_slot_id uuid references public.auction_slots (id);
alter table public.invoices
  add constraint invoices_subject_check check (request_id is not null or auction_slot_id is not null);
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (status in ('pending', 'issued', 'failed'));

create unique index invoices_auction_guest_idx on public.invoices (auction_slot_id, guest_id)
  where auction_slot_id is not null;
create index invoices_pending_idx on public.invoices (created_at) where status = 'pending';
