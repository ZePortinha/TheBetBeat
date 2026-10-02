/**
 * BetBeat worker entry — `pnpm worker` (tsx worker/index.ts).
 *
 * ./bootstrap MUST evaluate before anything that touches `@/lib/*`: it
 * neutralizes the `server-only` marker and loads .env.local. The runtime
 * is imported dynamically so no lib module can be hoisted ahead of it.
 */
import "./bootstrap";

void (async () => {
  const { runWorker } = await import("./runtime");
  await runWorker();
})().catch((error: unknown) => {
  console.error(
    `[worker] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
