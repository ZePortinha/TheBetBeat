import { defineConfig } from "vitest/config";
import path from "node:path";
import { testEnv } from "./tests/test-env";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "worker/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Integration tests live in tests/integration and run when SUPABASE_TEST=1,
    // against the test stack (tests/test-env.ts), never the dev database.
    ...(process.env.SUPABASE_TEST === "1"
      ? {
          include: ["tests/integration/**/*.test.ts"],
          env: testEnv,
          globalSetup: ["./tests/integration/global-setup.ts"],
        }
      : {}),
    testTimeout: 15000,
  },
});
