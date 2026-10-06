import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/domain/types";

export interface StaffContext {
  userId: string;
  email: string | null;
  memberships: Array<{
    staffId: string;
    venueId: string | null;
    role: Exclude<Role, "guest">;
    displayName: string;
  }>;
}

/**
 * Server-side staff gate (B12.3). Validates the session on every request,
 * loads venue memberships via RLS (staff can read their own rows), and
 * enforces MFA (AAL2) for managers/admins. Redirects when unmet.
 */
export async function requireStaff(
  allowed: Array<Exclude<Role, "guest">>,
  opts: { nextPath: string },
): Promise<StaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layouts pass a fixed fallback; the middleware knows the real deep link.
  const pathname = (await headers()).get("x-pathname");
  const nextPath = pathname && /^\/(?!\/)[\w\-/.]*$/.test(pathname) ? pathname : opts.nextPath;

  if (!user || user.is_anonymous) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: rows } = await supabase
    .from("staff")
    .select("id, venue_id, role, display_name")
    .eq("user_id", user.id);

  const memberships = (rows ?? []).map((r) => ({
    staffId: r.id as string,
    venueId: r.venue_id as string | null,
    role: r.role as Exclude<Role, "guest">,
    displayName: r.display_name as string,
  }));

  const match = memberships.filter((m) => allowed.includes(m.role));
  if (match.length === 0) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}&error=forbidden`);
  }

  // MFA is mandatory for managers and admins (B12.3).
  const needsMfa = match.some((m) => m.role === "manager" || m.role === "admin");
  if (needsMfa) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      redirect(`/login/mfa?next=${encodeURIComponent(nextPath)}`);
    }
  }

  return { userId: user.id, email: user.email ?? null, memberships };
}
