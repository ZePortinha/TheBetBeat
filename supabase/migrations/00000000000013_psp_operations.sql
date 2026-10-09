-- 2026-10-06 — PSP operation journal for real MB WAY (ifthenpay).
-- ifthenpay has no idempotency keys: a refund retried after a timeout would
-- pay the guest twice. Every push and refund claims its key here before the
-- HTTP call (lib/payments/journal.ts). Also the trail for "orphan" payments:
-- an MB WAY approved for a push whose payment row was never written (the
-- push call timed out), which the worker refunds automatically.

create table public.psp_operations (
  idempotency_key text primary key,
  kind text not null check (kind in ('charge', 'refund')),
  state text not null check (state in ('sending', 'done', 'refused', 'unknown')),
  -- charge: the payment's reference once known; refund: the payment refunded.
  provider_ref text,
  -- charge: the orderId sent to ifthenpay (comes back in the callback).
  order_id text,
  amount_cents int not null check (amount_cents > 0),
  result jsonb,
  last_error text,
  -- charge: a confirmed payment reached us (callback or poll).
  paid_at timestamptz,
  -- charge without a payments row: automatic refund bookkeeping.
  orphan_attempts int not null default 0,
  orphan_settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index psp_operations_ref_idx on public.psp_operations (provider_ref);
create index psp_operations_order_idx on public.psp_operations (order_id) where kind = 'charge';
create index psp_operations_orphans_idx on public.psp_operations (paid_at)
  where kind = 'charge' and paid_at is not null and orphan_settled_at is null;

create trigger psp_operations_touch before update on public.psp_operations
  for each row execute function public.touch_updated_at();

-- Money table: server only (B12.2).
alter table public.psp_operations enable row level security;
revoke all on public.psp_operations from anon, authenticated;
