import "server-only";

/**
 * Postgres access for the server orchestration layer (route handlers,
 * server actions, worker). One pg Pool per process, connected to
 * env.DATABASE_URL (B11 "Dados"); Supabase RLS does not apply here —
 * this connection is the server, so every call site is responsible for
 * its own authorization checks before touching money or requests.
 *
 * `withTransaction` is the atomicity primitive the domain service builds
 * on (B4.2 "Transições", B4.3 "Validação da cotação"): BEGIN → fn →
 * COMMIT, with ROLLBACK on any throw. Ledger groups, request_events and
 * audit rows always commit together with the state they describe.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "@/lib/security/env";

/**
 * Next.js dev/HMR re-evaluates modules; stash the pool on globalThis so
 * hot reloads reuse connections instead of leaking them.
 */
const globalForDb = globalThis as unknown as { __betbeatPool?: Pool };

function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Process-wide pg Pool singleton. */
export function getPool(): Pool {
  if (!globalForDb.__betbeatPool) {
    globalForDb.__betbeatPool = createPool();
  }
  return globalForDb.__betbeatPool;
}

/** One-off parameterized query on the pool (no transaction). */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params as unknown[]);
}

/**
 * Runs `fn` inside BEGIN/COMMIT, rolling back on any throw and always
 * releasing the client. The transaction is the serialization point for
 * slot reservation (B4.3): callers lock rows with SELECT … FOR UPDATE.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The connection is broken; release() below discards it.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the pool (tests / worker shutdown). */
export async function closePool(): Promise<void> {
  const pool = globalForDb.__betbeatPool;
  globalForDb.__betbeatPool = undefined;
  if (pool) await pool.end();
}
