/**
 * The test stack: a second local Supabase project ("betbeat-test", every
 * port + 100) that the integration and E2E suites use instead of the dev
 * database. Its supabase/ folder is regenerated from ./supabase on every
 * run (config, migrations, seed), so it cannot drift from the real one.
 *
 *   pnpm test:db           start it if needed, apply new migrations
 *   pnpm test:db --reset   back to migrations + seed (each E2E run does this)
 */
import "../worker/bootstrap";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testEnv } from "../tests/test-env";

const ROOT = path.resolve(__dirname, "..");
const WORKDIR = path.join(ROOT, "supabase-test");
const DIR = path.join(WORKDIR, "supabase");
// Not used by the app or the tests: keeps the second stack light.
const EXCLUDE = "studio,postgres-meta,mailpit,storage-api,imgproxy,logflare,vector,edge-runtime,supavisor";

function supabase(args: string, quiet = false): string {
  return execSync(`supabase ${args} --workdir "${WORKDIR}"`, {
    encoding: "utf8",
    stdio: quiet ? "pipe" : ["ignore", "inherit", "inherit"],
  }) ?? "";
}

function generate(): void {
  rmSync(path.join(DIR, "migrations"), { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  cpSync(path.join(ROOT, "supabase", "migrations"), path.join(DIR, "migrations"), { recursive: true });
  cpSync(path.join(ROOT, "supabase", "seed.sql"), path.join(DIR, "seed.sql"));
  const config = readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8")
    .replace(/^project_id = .*$/m, 'project_id = "betbeat-test"')
    .replace(/^(\s*\w*port\s*=\s*)(\d+)/gm, (_, key: string, port: string) => `${key}${Number(port) + 100}`);
  writeFileSync(path.join(DIR, "config.toml"), config);
}

/** The stack answers where tests/test-env.ts points, with the keys tests send. */
function check(): void {
  const status = Object.fromEntries(
    supabase("status -o env", true)
      .split(/\r?\n/)
      .map((line) => /^(\w+)="?(.*?)"?$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const expected: Array<[string, string | undefined, string | undefined]> = [
    ["API_URL", status.API_URL, testEnv.NEXT_PUBLIC_SUPABASE_URL],
    ["DB_URL", status.DB_URL, testEnv.DATABASE_URL],
    ["PUBLISHABLE_KEY", status.PUBLISHABLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ["SECRET_KEY", status.SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY],
  ];
  const wrong = expected.filter(([, got, want]) => got !== want).map(([name]) => name);
  if (wrong.length > 0) {
    throw new Error(
      `[test-stack] betbeat-test does not match tests/test-env.ts + .env.local: ${wrong.join(", ")}`,
    );
  }
}

function main(): void {
  generate();
  let running = true;
  try {
    supabase("status", true);
  } catch {
    running = false;
  }
  if (!running) {
    console.log("[test-stack] starting betbeat-test (about a minute)…");
    // A first start also applies the migrations and the seed.
    supabase(`start -x ${EXCLUDE}`, true);
  }
  if (process.argv.includes("--reset")) supabase("db reset");
  else if (running) supabase("migration up");
  check();
  console.log("[test-stack] betbeat-test ready (API 54421, DB 54422).");
}

main();
