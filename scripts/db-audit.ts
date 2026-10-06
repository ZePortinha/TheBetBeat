/**
 * pnpm db:audit — RLS & privilege audit (BRIEF B12.7).
 * Fails (exit 1) if:
 *   1. any table in `public` lacks RLS;
 *   2. any policy is a generic `true` (qual or with_check);
 *   3. anon/authenticated hold privileges beyond the expected matrix;
 *   4. any SECURITY DEFINER function in `public` lacks a pinned search_path.
 */
import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Tables whose writes are strictly server-only (service role). */
const SERVER_ONLY_WRITE = new Set([
  "payments",
  "refunds",
  "ledger_entries",
  "payouts",
  "invoices",
  "audit_log",
  "requests",
  "request_events",
  "quotes",
  "sessions",
  "session_tracks",
  "tracks",
  "staff",
  "session_settings",
  "library_tracks",
  "guest_phone_codes",
  "session_guest_list",
  "auction_slots",
  "auction_bids",
  "auction_contributions",
  "auction_intents",
  "wallet_entries",
  "wallet_preferences",
]);

/** Tables anon (no session at all) may never touch. */
const NO_ANON = new Set([
  "venues", "zones", "staff", "library_tracks", "tracks", "guests",
  "genre_multipliers", "session_settings", "payments", "refunds",
  "ledger_entries", "payouts", "invoices", "audit_log", "guest_phone_codes",
  "session_guest_list", "auction_slots", "auction_bids", "auction_contributions",
  "auction_intents", "wallet_entries", "auction_slot_metrics", "wallet_preferences",
]);

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const failures: string[] = [];

  // 1. RLS on every public table.
  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`,
  );
  for (const row of rls.rows) {
    if (!row.relrowsecurity) {
      failures.push(`RLS disabled on public.${row.relname}`);
    }
  }

  // 2. No generic-true policies.
  const pols = await client.query<{
    tablename: string;
    policyname: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `select tablename, policyname, qual, with_check
     from pg_policies where schemaname = 'public'`,
  );
  for (const p of pols.rows) {
    for (const [kind, expr] of [["USING", p.qual], ["WITH CHECK", p.with_check]] as const) {
      if (expr && expr.trim().toLowerCase() === "true") {
        failures.push(
          `Generic ${kind} (true) policy: ${p.tablename}.${p.policyname}`,
        );
      }
    }
  }

  // 3. Privilege matrix for anon / authenticated.
  const grants = await client.query<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }>(
    `select table_name, grantee, privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
  );
  for (const g of grants.rows) {
    const write = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(
      g.privilege_type,
    );
    if (write && SERVER_ONLY_WRITE.has(g.table_name)) {
      // guests may update their own row; everything else: server only.
      failures.push(
        `${g.grantee} holds ${g.privilege_type} on server-only table ${g.table_name}`,
      );
    }
    if (g.grantee === "anon" && NO_ANON.has(g.table_name)) {
      failures.push(`anon holds ${g.privilege_type} on ${g.table_name}`);
    }
  }

  // 4. SECURITY DEFINER functions must pin search_path.
  const fns = await client.query<{ proname: string; proconfig: string[] | null }>(
    `select p.proname, p.proconfig
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef`,
  );
  for (const f of fns.rows) {
    const pinned = (f.proconfig ?? []).some((c) => c.startsWith("search_path="));
    if (!pinned) {
      failures.push(`SECURITY DEFINER without pinned search_path: ${f.proname}`);
    }
  }

  await client.end();

  if (failures.length > 0) {
    console.error(`\n✗ db:audit FAILED (${failures.length} issue(s)):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ db:audit passed — ${rls.rows.length} tables with RLS, ` +
      `${pols.rows.length} policies, no generic-true, privileges within matrix.`,
  );
}

main().catch((err) => {
  console.error("db:audit error:", err.message);
  process.exit(1);
});
