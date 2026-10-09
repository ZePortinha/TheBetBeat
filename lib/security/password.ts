/** Staff passwords (2026-10-06). Supabase enforces the same minimum (config.toml). */
export const MIN_STAFF_PASSWORD = 12;

/** Invited staff sign in with a temporary password and must replace it first. */
export function mustChangePassword(user: { app_metadata?: Record<string, unknown> | null }): boolean {
  return user.app_metadata?.must_change_password === true;
}
