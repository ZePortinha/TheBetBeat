-- 2026-10-06 — Durable SMS sign-in caps (app/api/guest/phone): codes sent
-- per number per hour/day are counted here, so the lookup needs an index.
create index guest_phone_codes_phone_idx
  on public.guest_phone_codes (phone_hash, created_at desc);
