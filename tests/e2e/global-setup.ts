import { execSync } from "node:child_process";

/** Every E2E run starts from migrations + seed on the test stack. */
export default function globalSetup(): void {
  execSync("pnpm exec tsx scripts/test-stack.ts --reset", { stdio: "inherit" });
}
