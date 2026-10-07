/**
 * Runs before `pnpm dev`: stops in seconds with the fix spelled out, instead
 * of booting an app whose Supabase, database or public URL is unreachable
 * (a dead tunnel left in .env.local made guest sign-in fail silently).
 */
import "../worker/bootstrap";
import { lookup } from "node:dns/promises";
import { Client } from "pg";

async function main(): Promise<void> {
  let env: typeof import("@/lib/security/env").env;
  try {
    ({ env } = await import("@/lib/security/env"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const problems: string[] = [];

  const supabase = env.NEXT_PUBLIC_SUPABASE_URL;
  const health = await fetch(new URL("/auth/v1/health", supabase), {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(4000),
  }).then((r) => r.ok, () => false);
  if (!health) {
    problems.push(
      `Supabase não responde em ${supabase}. Corre \`supabase start\`, ou corrige NEXT_PUBLIC_SUPABASE_URL (local: http://127.0.0.1:54321).`,
    );
  }

  const db = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 4000 });
  try {
    await db.connect();
  } catch {
    problems.push("A base de dados (DATABASE_URL) não aceita ligações. Corre `supabase start`.");
  } finally {
    await db.end().catch(() => undefined);
  }

  const appHost = new URL(env.NEXT_PUBLIC_APP_URL).hostname;
  if (!(await lookup(appHost).then(() => true, () => false))) {
    problems.push(
      `NEXT_PUBLIC_APP_URL aponta para ${appHost}, que não existe (túnel desligado?). Em local usa http://localhost:3000.`,
    );
  }

  if (problems.length > 0) {
    console.error(`\n[dev-check] O ambiente não está pronto:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("[dev-check] Supabase, base de dados e URL da app OK.");
}

void main();
