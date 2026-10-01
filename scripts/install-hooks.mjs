// Installs the git pre-commit hook (lint + typecheck + gitleaks).
// Runs automatically via the pnpm "prepare" script. Safe to re-run.
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const hooksDir = join(process.cwd(), ".git", "hooks");
if (!existsSync(hooksDir)) {
  // Not a git checkout (e.g. CI tarball) — nothing to do.
  process.exit(0);
}

const hook = `#!/bin/sh
# BetBeat pre-commit: secrets scan, lint, typecheck. See BETBEAT_BRIEF.md B12.1.
set -e

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact -v
else
  echo "[pre-commit] WARNING: gitleaks not installed — secrets scan skipped." >&2
fi

pnpm lint
pnpm typecheck
`;

mkdirSync(hooksDir, { recursive: true });
writeFileSync(join(hooksDir, "pre-commit"), hook, { encoding: "utf8" });
try {
  chmodSync(join(hooksDir, "pre-commit"), 0o755);
} catch {
  // Windows: chmod is a no-op; git-bash executes hooks regardless.
}
console.log("[hooks] pre-commit installed");
