---
paths:
  - "lib/payments/**"
  - "lib/ledger/**"
  - "lib/domain/**"
  - "worker/**"
---

# Money rules

- Amounts are ALWAYS integer cents (`amount_cents`). No floats, no strings.
- Every money operation is idempotent: a unique idempotency key per logical
  operation (refunds: one per request+reason). Duplicate webhooks must be no-ops.
- Request state transitions happen ONLY on the server, through the pure state
  machine in `lib/domain` (with `now` injected); each transition writes a
  `request_event` and an audit record.
- The ledger is double-entry and immutable: each group of entries sums to zero;
  balances are always derived, never stored as truth.
- Card/wallet: authorize at request, capture only when the track plays; capture
  only the QUEUE value on a missed promise; void when nothing plays. MB WAY:
  immediate charge + automatic refund.
- Refund failures: retry with backoff + admin alert. PSP fees are never deducted
  from the guest.
- Deadlines expire only on the server (worker) — never trust client timers.
