-- BetBeat RLS (BRIEF B12.2): RLS on EVERY table, default deny, scoped policies.
-- Money & audit tables get NO client policies — server (service role) only.

-- ── Helpers (security definer avoids recursive RLS on staff) ────────
create or replace function public.has_venue_role(
  p_venue uuid,
  p_roles public.staff_role[]
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    where s.venue_id = p_venue
      and s.user_id = (select auth.uid())
      and s.role = any (p_roles)
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff s
    where s.user_id = (select auth.uid())
      and s.role = 'admin'
  );
$$;

create or replace function public.session_venue(p_session uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select venue_id from public.sessions where id = p_session;
$$;

revoke execute on function public.has_venue_role(uuid, public.staff_role[]) from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.session_venue(uuid) from public, anon;
grant execute on function public.has_venue_role(uuid, public.staff_role[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.session_venue(uuid) to authenticated;

-- ── Enable RLS everywhere ───────────────────────────────────────────
alter table public.venues enable row level security;
alter table public.zones enable row level security;
alter table public.staff enable row level security;
alter table public.sessions enable row level security;
alter table public.session_settings enable row level security;
alter table public.library_tracks enable row level security;
alter table public.tracks enable row level security;
alter table public.session_tracks enable row level security;
alter table public.guests enable row level security;
alter table public.quotes enable row level security;
alter table public.requests enable row level security;
alter table public.request_events enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.payouts enable row level security;
alter table public.invoices enable row level security;
alter table public.genre_multipliers enable row level security;
alter table public.audit_log enable row level security;

-- ── Defense in depth: strip privileges clients never need ───────────
-- anon (no session at all) touches nothing in public: even "public" reads
-- (display, now-on-the-floor) are served by the server or broadcast channels.
revoke all on all tables in schema public from anon;

-- Server-only writes: authenticated keeps SELECT (policy-gated) at most.
do $$
declare t text;
begin
  foreach t in array array[
    'payments', 'refunds', 'ledger_entries', 'payouts', 'invoices', 'audit_log',
    'requests', 'request_events', 'quotes', 'sessions', 'session_tracks',
    'tracks', 'staff', 'session_settings', 'library_tracks'
  ] loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated',
      t
    );
  end loop;
end $$;

-- Policy-gated client writes keep only the verbs their policies allow.
revoke insert, delete, truncate, references, trigger on public.venues from authenticated;
revoke truncate, references, trigger on public.zones from authenticated;
revoke insert, delete, truncate, references, trigger on public.genre_multipliers from authenticated;
revoke delete, truncate, references, trigger on public.guests from authenticated;

-- ── Organisation ────────────────────────────────────────────────────
create policy venues_staff_select on public.venues
  for select to authenticated
  using (
    public.has_venue_role(id, array['dj', 'manager', 'admin']::public.staff_role[])
    or public.is_platform_admin()
  );
create policy venues_manager_update on public.venues
  for update to authenticated
  using (public.has_venue_role(id, array['manager', 'admin']::public.staff_role[]))
  with check (public.has_venue_role(id, array['manager', 'admin']::public.staff_role[]));

create policy zones_staff_select on public.zones
  for select to authenticated
  using (
    public.has_venue_role(venue_id, array['dj', 'manager', 'admin']::public.staff_role[])
    or public.is_platform_admin()
  );
create policy zones_manager_write on public.zones
  for all to authenticated
  using (public.has_venue_role(venue_id, array['manager', 'admin']::public.staff_role[]))
  with check (public.has_venue_role(venue_id, array['manager', 'admin']::public.staff_role[]));

create policy staff_select_own_or_managed on public.staff
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_venue_role(venue_id, array['manager', 'admin']::public.staff_role[])
    or public.is_platform_admin()
  );
-- Staff rows are managed by the server (console API) — no client writes.

create policy sessions_staff_select on public.sessions
  for select to authenticated
  using (
    public.has_venue_role(venue_id, array['dj', 'manager', 'admin']::public.staff_role[])
    or public.is_platform_admin()
  );

create policy session_settings_staff_select on public.session_settings
  for select to authenticated
  using (
    public.has_venue_role(
      public.session_venue(session_id),
      array['dj', 'manager', 'admin']::public.staff_role[]
    )
  );

-- ── Catalog ─────────────────────────────────────────────────────────
create policy library_tracks_staff_select on public.library_tracks
  for select to authenticated
  using (
    public.has_venue_role(venue_id, array['dj', 'manager', 'admin']::public.staff_role[])
  );
-- Guest search goes through the API (server DTOs) — no direct guest reads.

-- tracks (global catalog cache): no client policies — reads go through server
-- DTOs (search API), writes are server-only. Default deny.

create policy session_tracks_staff_select on public.session_tracks
  for select to authenticated
  using (
    public.has_venue_role(
      public.session_venue(session_id),
      array['dj', 'manager', 'admin']::public.staff_role[]
    )
  );

-- ── Guests own their data (anonymous auth uid) ──────────────────────
create policy guests_select_own on public.guests
  for select to authenticated
  using (id = (select auth.uid()));
create policy guests_insert_own on public.guests
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy guests_update_own on public.guests
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- NOTE: encrypted phone/email columns are written by the server; the client
-- only ever updates handle/opt-ins via a server action with a strict schema.

create policy quotes_select_own on public.quotes
  for select to authenticated
  using (guest_id = (select auth.uid()));
create policy quotes_staff_select on public.quotes
  for select to authenticated
  using (
    public.has_venue_role(
      public.session_venue(session_id),
      array['dj', 'manager', 'admin']::public.staff_role[]
    )
  );

create policy requests_select_own on public.requests
  for select to authenticated
  using (guest_id = (select auth.uid()));
create policy requests_staff_select on public.requests
  for select to authenticated
  using (
    public.has_venue_role(venue_id, array['dj', 'manager', 'admin']::public.staff_role[])
  );

create policy request_events_staff_select on public.request_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = request_id
        and public.has_venue_role(
          r.venue_id, array['dj', 'manager', 'admin']::public.staff_role[]
        )
    )
  );

-- ── Money & audit: NO client policies. Server only (B12.2). ────────
-- payments / refunds / ledger_entries / payouts / invoices / audit_log:
-- RLS enabled above with zero policies = default deny for anon+authenticated.
-- Staff see money data through server DTOs that scope to their venue.

-- ── Pricing ─────────────────────────────────────────────────────────
create policy genre_multipliers_staff_select on public.genre_multipliers
  for select to authenticated
  using (
    public.has_venue_role(venue_id, array['dj', 'manager', 'admin']::public.staff_role[])
  );
create policy genre_multipliers_manager_update on public.genre_multipliers
  for update to authenticated
  using (public.has_venue_role(venue_id, array['manager', 'admin']::public.staff_role[]))
  with check (
    public.has_venue_role(venue_id, array['manager', 'admin']::public.staff_role[])
  );

-- ── Realtime broadcast authorization (B11 "Tempo real") ────────────
-- Topics: session:<id>:staff (staff), guest:<uuid> (own), session:<id>:public.
create policy staff_broadcasts on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'session:%:staff'
    and public.has_venue_role(
      public.session_venue(split_part(realtime.topic(), ':', 2)::uuid),
      array['dj', 'manager', 'admin']::public.staff_role[]
    )
  );

create policy guest_broadcasts on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'guest:' || (select auth.uid())::text);

create policy public_broadcasts on realtime.messages
  for select to anon, authenticated
  using (realtime.topic() like 'session:%:public');
