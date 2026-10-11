/**
 * Phone login (owner, 2026-10-10) against the local Supabase stack: the
 * number is the account. A second phone proving the same number is signed
 * in AS the first guest (real Supabase Auth session), keeps its @ and
 * sees its balance; a new number becomes a new account.
 *
 *   SUPABASE_TEST=1 pnpm exec vitest run tests/integration/phone-account.integration.test.ts
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

try {
  const raw = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
} catch {
  /* env already set */
}

const db = await import("@/lib/db");
const account = await import("@/lib/guests/account");
const phoneHandles = await import("@/lib/guests/phone-handle");
const { hashPhone } = await import("@/lib/security/crypto");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RUN = randomUUID().slice(0, 8);

/** A brand-new phone/browser: an anonymous Supabase guest. */
async function newPhone(): Promise<string> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  await db.query(`insert into public.guests (id) values ($1) on conflict do nothing`, [data.user.id]);
  return data.user.id;
}

afterAll(async () => {
  await db.closePool();
});

describe("the number is the account", () => {
  it("a second phone with the same number signs in as the first guest, with its @", async () => {
    const number = `+3519${String(parseInt(RUN.slice(0, 7), 16) % 100_000_000).padStart(8, "0")}`;
    const hash = hashPhone(number);
    const first = await newPhone();
    expect(await account.resolvePhoneAccount(db.getPool(), first, hash)).toEqual({ kind: "claimed", accountId: first });
    await db.query(`update public.guests set handle = $2, phone_hash = $3, phone_verified_at = now() where id = $1`, [
      first,
      `conta${RUN}`,
      hash,
    ]);
    await phoneHandles.linkPhoneHandle(db.getPool(), first, hash);
    expect(await account.resolvePhoneAccount(db.getPool(), first, hash)).toEqual({ kind: "same", accountId: first });

    const second = await newPhone();
    expect(await account.resolvePhoneAccount(db.getPool(), second, hash)).toEqual({ kind: "switch", accountId: first });

    // A real session for the first guest, usable like any Supabase login.
    const session = await account.sessionForGuest(first);
    expect(session).not.toBeNull();
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const who = await admin.auth.getUser(session!.accessToken);
    expect(who.data.user?.id).toBe(first);
    // RLS sees the guest's own row through that session.
    const asFirst = createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session!.accessToken}` } },
    });
    const own = await asFirst.from("guests").select("id, handle").eq("id", first).single();
    expect(own.data).toEqual({ id: first, handle: `conta${RUN}` });
    // And again later (the internal address is reused, never duplicated).
    expect(await account.sessionForGuest(first)).not.toBeNull();
  }, 60_000);

  it("a guest that proves another number moves its account to it", async () => {
    const a = hashPhone(`+3519${RUN.replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`);
    const b = hashPhone(`+3519${RUN.replace(/\D/g, "").padEnd(8, "2").slice(0, 8)}x`);
    const guest = await newPhone();
    expect((await account.resolvePhoneAccount(db.getPool(), guest, a)).kind).toBe("claimed");
    expect((await account.resolvePhoneAccount(db.getPool(), guest, b)).kind).toBe("claimed");
    const rows = await db.query<{ phone_hash: string }>(`select phone_hash from public.phone_accounts where guest_id = $1`, [guest]);
    expect(rows.rows.map((r) => r.phone_hash)).toEqual([b]);
    // The old number is free again: a new phone claims it as a new account.
    const other = await newPhone();
    expect(await account.resolvePhoneAccount(db.getPool(), other, a)).toEqual({ kind: "claimed", accountId: other });
  }, 60_000);
});
