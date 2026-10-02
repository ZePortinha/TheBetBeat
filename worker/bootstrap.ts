/**
 * Worker bootstrap — MUST be fully evaluated before any `@/lib/*` import.
 *
 * It does two things no lib module can do for itself:
 *
 * 1. Neutralizes the `server-only` marker package. lib/db, lib/security/env
 *    and the services import it so Next.js refuses to bundle them into
 *    client code (B12.1). Outside a React Server environment the package's
 *    default entry throws on require — but the worker IS the server, so we
 *    redirect its resolution to the package's own `empty.js` (the exact
 *    file Next serves under the `react-server` condition). tsx runs this
 *    repo as CommonJS (no "type": "module"), so patching the CJS resolver
 *    covers every transpiled `import "server-only"`.
 *
 * 2. Loads `.env.local` into process.env (tsx does not load dotenv files),
 *    so lib/security/env.ts can validate the environment at boot. Existing
 *    process.env values always win — nothing is overwritten.
 */

import Module from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

type ResolveFilename = (this: unknown, request: string, ...rest: unknown[]) => string;

function neutralizeServerOnly(): void {
  const internals = Module as unknown as { _resolveFilename: ResolveFilename };
  const original = internals._resolveFilename;
  internals._resolveFilename = function (
    this: unknown,
    request: string,
    ...rest: unknown[]
  ): string {
    const resolved = original.call(this, request, ...rest);
    if (request === "server-only") {
      // …/node_modules/server-only/index.js → …/server-only/empty.js
      return resolved.replace(/index\.js$/, "empty.js");
    }
    return resolved;
  };
}

/** Minimal .env parser — KEY=value lines, optional single/double quotes. */
function loadDotEnvLocal(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(__dirname, "..", ".env.local"),
  ];
  for (const file of candidates) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue; // not found here — try the next candidate
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1];
      let value = match[2] ?? "";
      if (key === undefined || key.length === 0) continue;
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return; // first file found wins
  }
}

neutralizeServerOnly();
loadDotEnvLocal();
