-- 2026-10-06 — Security hardening (overnight review).

-- ── Column-level write privileges (no mass assignment through PostgREST) ──
-- RLS decides WHICH rows a client may write; it says nothing about WHICH
-- columns. Table-wide UPDATE let a client set any column of a row it owns:

-- guests: a guest could set its own phone_verified_at/phone_hash directly,
-- "prove" a number it never verified and take over that number's @ (and see
-- its party). Clients only ever create their row with a locale; every other
-- column is written by the server.
revoke insert, update on public.guests from authenticated;
grant insert (id, locale) on public.guests to authenticated;
grant update (id, locale) on public.guests to authenticated;

-- venues: a manager could set betbeat_fee_bps to 0 or rewrite settings
-- (platform feature flags, defaultVenueShareBps) from the browser. The
-- console writes through the server; the client keeps the name only.
revoke update on public.venues from authenticated;
grant update (name) on public.venues to authenticated;

-- zones: managers may create, rename and delete their zones; the QR slug and
-- the venue stay server-owned.
revoke insert, update on public.zones from authenticated;
grant insert (venue_id, name) on public.zones to authenticated;
grant update (name) on public.zones to authenticated;

-- genre_multipliers: managers tune the multiplier and auto-apply; the
-- recommendation and its metrics are computed by the worker.
revoke update on public.genre_multipliers from authenticated;
grant update (multiplier, auto_apply) on public.genre_multipliers to authenticated;

-- ── Durable SMS sign-in caps (app/api/guest/phone) ──────────────────
-- Codes sent per number per hour/day are counted here.
create index guest_phone_codes_phone_idx
  on public.guest_phone_codes (phone_hash, created_at desc);
