"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/security/redirect";
import { MIN_STAFF_PASSWORD, mustChangePassword } from "@/lib/security/password";

/**
 * First sign-in of an invited staff member (2026-10-06): the temporary
 * password was shown on a manager's screen, so it is replaced before any
 * staff surface opens. The flag lives in app_metadata (only the service
 * role can write it), set at invite time and cleared here.
 */
const schema = z
  .object({
    password: z.string().min(MIN_STAFF_PASSWORD).max(200),
    confirm: z.string().max(200),
    next: z.unknown().transform((v) => safeNextPath(v, "/cockpit")),
  })
  .strict();

export type PasswordState = { error?: "short" | "mismatch" | "same" | "failed" } | null;

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/login");

  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    next: formData.get("next") ?? "/cockpit",
  });
  if (!parsed.success) return { error: "short" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: /same|different/i.test(error.message) ? "same" : "failed" };
  }
  if (mustChangePassword(user)) {
    const admin = createAdminClient();
    const { error: flagError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, must_change_password: false },
    });
    if (flagError) return { error: "failed" };
    // The session's JWT still carries the old app_metadata until refreshed.
    await supabase.auth.refreshSession();
  }
  redirect(parsed.data.next);
}
