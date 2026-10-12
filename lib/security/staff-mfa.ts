import "server-only";
import { cookies } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/security/env";
import { DEV_MFA_COOKIE, verifyDevMfa } from "@/lib/security/dev-mfa";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Has this staff session passed the second factor? AAL2 from Supabase TOTP,
 * or (development only, see dev-mfa.ts) the test-code cookie for this user.
 */
export async function hasStaffMfa(supabase: Supabase, userId: string): Promise<boolean> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") return true;
  const cookie = (await cookies()).get(DEV_MFA_COOKIE)?.value;
  return verifyDevMfa(cookie, userId, env.QR_TOKEN_SECRET);
}
