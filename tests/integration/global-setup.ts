import { execSync } from "node:child_process";

/** The test stack is up and on the latest migrations before any test. */
export default function setup(): void {
  execSync("pnpm exec tsx scripts/test-stack.ts", { stdio: "inherit" });
}
