import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "worker/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Integration tests that need the local Supabase stack live in
    // tests/integration and are included when SUPABASE_TEST=1.
    ...(process.env.SUPABASE_TEST === "1"
      ? { include: ["tests/integration/**/*.test.ts"] }
      : {}),
    testTimeout: 15000,
  },
});
