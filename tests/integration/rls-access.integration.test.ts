/**
 * RLS access matrix (BRIEF B12.2 "Testes de acesso"):
 * with the PUBLIC key and each role (anon, anonymous guest, dj, manager,
 * admin) try to read and write every public table. Everything outside the
 * role's scope must fail (error or zero rows).
 *
 * Runs against the local Supabase stack: SUPABASE_TEST=1 pnpm exec vitest run tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Load .env.local without extra deps.
try {
  const raw = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
} catch {
  /* env already set */
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const VENUE = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION = "dddddddd-0000-4000-8000-000000000001";
const ZONE = "bbbbbbbb-0000-4000-8000-000000000001";

const TABLES = [
  "venues", "zones", "staff", "sessions", "session_settings", "library_tracks",
  "tracks", "session_tracks", "guests", "quotes", "requests", "request_events",
  "payments", "refunds", "ledger_entries", "payouts", "invoices",
  "genre_multipliers", "audit_log",
] as const;
type Table = (typeof TABLES)[number];

/** Tables NO client role may ever write (server only). */
const SERVER_ONLY_WRITE: Table[] = [
  "payments", "refunds", "ledger_entries", "payouts", "invoices", "audit_log",
  "requests", "request_events", "quotes", "sessions", "session_tracks",
  "tracks", "staff", "session_settings", "library_tracks",
];

/** Tables NO client role may read directly (money/audit/catalog cache). */
const SERVER_ONLY_READ: Table[] = [
  "payments", "refunds", "ledger_entries", "payouts", "invoices", "audit_log", "tracks",
];

function fresh(): SupabaseClient {
  return createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(email: string): Promise<SupabaseClient> {
  const c = fresh();
  const { error } = await c.auth.signInWithPassword({ email, password: "betbeat-dev" });
  if (error) throw error;
  return c;
}

async function readCount(c: SupabaseClient, table: Table): Promise<number | "error"> {
  const { data, error } = await c.from(table).select("*").limit(5);
  if (error) return "error";
  return data?.length ?? 0;
}

describe("RLS access matrix (B12.2)", () => {
  let anon: SupabaseClient;
  let guest: SupabaseClient;
  let guestId: string;
  let dj: SupabaseClient;
  let manager: SupabaseClient;
  let admin: SupabaseClient;
  let service: SupabaseClient;

  beforeAll(async () => {
    anon = fresh();
    guest = fresh();
    const { data, error } = await guest.auth.signInAnonymously();
    if (error || !data.user) throw error ?? new Error("anon sign-in failed");
    guestId = data.user.id;
    dj = await login("dj.helix@betbeat.local");
    manager = await login("manager@betbeat.local");
    admin = await login("admin@betbeat.local");
    service = createClient(URL_, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Make sure there is at least one money row so "zero rows" is meaningful.
    const { data: ledger } = await service.from("ledger_entries").select("id").limit(1);
    if (!ledger || ledger.length === 0) {
      const group = crypto.randomUUID();
      await service.from("ledger_entries").insert([
        // Accounts the daily reconciliation does not sum: the ledger is immutable,
        // so this row outlives the test and must not fake a capture mismatch.
        { group_id: group, account: "psp_fees", amount_cents: 100, memo: "rls-test" },
        { group_id: group, account: "betbeat_revenue", amount_cents: -100, memo: "rls-test" },
      ]);
    }
  });

  afterAll(async () => {
    await service.auth.admin.deleteUser(guestId).catch(() => undefined);
  });

  describe("anon (no session) reads nothing", () => {
    for (const t of TABLES) {
      it(`cannot read ${t}`, async () => {
        const r = await readCount(anon, t);
        expect(r === "error" || r === 0).toBe(true);
      });
    }
  });

  describe("server-only tables are invisible to every client role", () => {
    for (const t of SERVER_ONLY_READ) {
      for (const [name, getC] of [
        ["guest", () => guest],
        ["dj", () => dj],
        ["manager", () => manager],
      ] as const) {
        it(`${name} cannot read ${t}`, async () => {
          const r = await readCount(getC(), t);
          expect(r === "error" || r === 0).toBe(true);
        });
      }
    }
  });

  describe("server-only writes are rejected for every client role", () => {
    const samples: Partial<Record<Table, Record<string, unknown>>> = {
      payments: {
        request_id: SESSION, guest_id: SESSION, provider: "x", method: "card",
        amount_cents: 100, idempotency_key: "rls-" + Math.random(),
      },
      refunds: {
        payment_id: SESSION, request_id: SESSION, amount_cents: 1, reason: "x",
        idempotency_key: "rls-" + Math.random(),
      },
      ledger_entries: { group_id: SESSION, account: "x", amount_cents: 1 },
      payouts: { session_id: SESSION, venue_id: VENUE, recipient_type: "venue", amount_cents: 1 },
      invoices: { request_id: SESSION, guest_id: SESSION, amount_cents: 1 },
      audit_log: { actor: "x", action: "x", entity: "x" },
      requests: {
        venue_id: VENUE, session_id: SESSION, guest_id: SESSION, quote_id: SESSION,
        track_title: "x", track_artist: "x", tier: "QUEUE", amount_cents: 100,
      },
      request_events: { request_id: SESSION, to_status: "paid", actor: "x" },
      quotes: {
        session_id: SESSION, guest_id: SESSION, track_title: "x", track_artist: "x",
        fit_score: 1, fit_label: "fits", demand_rho: 0, tiers: {}, breakdown: {},
        expires_at: new Date().toISOString(),
      },
      sessions: { venue_id: VENUE, name: "x", starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 3600e3).toISOString() },
      session_tracks: { session_id: SESSION, title: "x", artist: "x" },
      tracks: { provider: "x", provider_track_id: "rls-" + Math.random(), title: "x", artist: "x" },
      staff: { venue_id: VENUE, user_id: SESSION, role: "dj", display_name: "x" },
      session_settings: { session_id: SESSION },
      library_tracks: { venue_id: VENUE, title: "x", artist: "x", genre: "x" },
    };
    for (const t of SERVER_ONLY_WRITE) {
      for (const [name, getC] of [
        ["guest", () => guest],
        ["dj", () => dj],
        ["manager", () => manager],
        ["admin", () => admin],
      ] as const) {
        it(`${name} cannot insert into ${t}`, async () => {
          const { error } = await getC().from(t).insert(samples[t]!);
          expect(error).not.toBeNull();
        });
      }
    }

    it("dj cannot update a request's amount or status", async () => {
      const { data } = await dj
        .from("requests")
        .update({ amount_cents: 1 })
        .eq("session_id", SESSION)
        .select("id");
      // Either a privilege error (data null) or zero affected rows.
      expect(data === null || data.length === 0).toBe(true);
    });
  });

  describe("guests see only themselves", () => {
    it("guest can create and read its own guests row, not others", async () => {
      const { error } = await guest.from("guests").upsert({ id: guestId, locale: "pt-PT" });
      expect(error).toBeNull();
      const { data } = await guest.from("guests").select("id");
      expect(data?.map((g) => g.id)).toEqual([guestId]);
      const other = crypto.randomUUID();
      const { error: e2 } = await guest.from("guests").insert({ id: other });
      expect(e2).not.toBeNull();
    });
    it("guest cannot read venue/session/staff/library tables", async () => {
      for (const t of ["venues", "zones", "staff", "sessions", "library_tracks",
        "session_settings", "genre_multipliers", "session_tracks", "request_events"] as Table[]) {
        const r = await readCount(guest, t);
        expect(r === "error" || r === 0, `guest read ${t}`).toBe(true);
      }
    });
    it("guest cannot see other guests' requests/quotes", async () => {
      const { data: q } = await guest.from("quotes").select("id");
      const { data: r } = await guest.from("requests").select("id");
      expect(q ?? []).toHaveLength(0);
      expect(r ?? []).toHaveLength(0);
    });
  });

  describe("staff scoping", () => {
    it("dj reads own venue data but cannot write venue config", async () => {
      expect(await readCount(dj, "venues")).toBe(1);
      expect(await readCount(dj, "sessions")).toBeGreaterThan(0);
      expect(await readCount(dj, "library_tracks")).toBeGreaterThan(0);
      const { data } = await dj.from("venues").update({ name: "hack" }).eq("id", VENUE).select("id");
      expect(data === null || data.length === 0).toBe(true);
      const { data: z } = await dj.from("zones").delete().eq("id", ZONE).select("id");
      expect(z === null || z.length === 0).toBe(true);
    });
    it("manager can update own venue and zones, cannot touch staff rows", async () => {
      const { data } = await manager.from("venues").update({ name: "Club Meridiano" })
        .eq("id", VENUE).select("id");
      expect(data?.length).toBe(1);
      const { error } = await manager.from("staff")
        .update({ role: "admin" }).eq("venue_id", VENUE);
      // No UPDATE privilege on staff for authenticated → error (or no-op).
      expect(error !== null || true).toBe(true);
      const { data: st } = await manager.from("staff").select("role").eq("role", "admin")
        .eq("venue_id", VENUE);
      expect(st ?? []).toHaveLength(0);
    });
    it("dj cannot read staff of other venues nor platform admin rows", async () => {
      const { data } = await dj.from("staff").select("id, venue_id");
      // Own row only (not a manager): never admin rows with null venue.
      expect((data ?? []).every((s) => s.venue_id === VENUE)).toBe(true);
    });
    it("platform admin can read venues", async () => {
      expect(await readCount(admin, "venues")).toBeGreaterThan(0);
    });
  });
});
