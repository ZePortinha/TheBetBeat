import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/security/env";

/**
 * Service-role client — bypasses RLS. SERVER ONLY (B12.1).
 * Use exclusively inside route handlers, server actions and the worker,
 * and only for operations the RLS model intentionally reserves for the server.
 */
export function createAdminClient() {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
