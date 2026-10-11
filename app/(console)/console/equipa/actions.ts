"use server";

/**
 * Equipa (B9.4): invite / change role / remove venue staff.
 *
 * Invites create the auth user server-side via the admin client with a
 * one-time temp password (shown exactly once in the response — never
 * persisted by the app, B12.3). Roles are a strict dj|manager allowlist:
 * platform admin is NEVER grantable from the console. Every mutation is
 * venue-scoped and audited.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

const roleSchema = z.enum(["dj", "manager"]);

/* ------------------------------------------------------------------ */
/* Invite                                                              */
/* ------------------------------------------------------------------ */

const inviteSchema = z
  .object({
    venueId: z.string().uuid(),
    email: z.string().email().max(200),
    displayName: z.string().trim().min(1).max(60),
    role: roleSchema,
  })
  .strict();

export type InviteState = {
  ok?: boolean;
  tempPassword?: string;
  email?: string;
  error?: "invalid" | "emailExists" | "createFailed";
} | null;

export async function inviteStaffAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ctx = await requireConsole("/console/equipa");
  const parsed = inviteSchema.safeParse({
    venueId: formData.get("venueId"),
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "invalid" };
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  // One-time password: 12 chars url-safe. Supabase hashes it; we only
  // ever show it once in this response.
  const tempPassword = randomBytes(9).toString("base64url");

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    // Shown once on the manager's screen: replaced at first sign-in (/login/password).
    app_metadata: { must_change_password: true },
  });
  if (error || !created.user) {
    const exists = /already|exists|registered/i.test(error?.message ?? "");
    return { error: exists ? "emailExists" : "createFailed" };
  }

  await query(
    `insert into public.staff (venue_id, user_id, role, display_name)
     values ($1, $2, $3, $4)`,
    [venueId, created.user.id, parsed.data.role, parsed.data.displayName],
  );
  await audit(ctx, "staff.invited", "staff", created.user.id, venueId, {
    email: parsed.data.email,
    role: parsed.data.role,
  });
  revalidatePath("/console/equipa");
  return { ok: true, tempPassword, email: parsed.data.email };
}

/* ------------------------------------------------------------------ */
/* Change role                                                         */
/* ------------------------------------------------------------------ */

const roleChangeSchema = z
  .object({ staffId: z.string().uuid(), role: roleSchema })
  .strict();

export async function changeRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/equipa");
  const parsed = roleChangeSchema.safeParse({
    staffId: formData.get("staffId"),
    role: formData.get("role"),
  });
  if (!parsed.success) redirect("/console/equipa?error=invalid");

  // Scoped: only rows of venues this user controls; platform admin rows
  // (venue_id null) can never be touched here.
  const res = await query<{ venue_id: string }>(
    `update public.staff set role = $2
      where id = $1 and venue_id = any($3::uuid[]) and role <> 'admin'
      returning venue_id`,
    [parsed.data.staffId, parsed.data.role, ctx.venues.map((v) => v.id)],
  );
  if (res.rows[0]) {
    await audit(ctx, "staff.role_changed", "staff", parsed.data.staffId, res.rows[0].venue_id, {
      role: parsed.data.role,
    });
  }
  revalidatePath("/console/equipa");
  redirect("/console/equipa");
}

/* ------------------------------------------------------------------ */
/* Remove                                                              */
/* ------------------------------------------------------------------ */

const removeSchema = z.object({ staffId: z.string().uuid() }).strict();

export async function removeStaffAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/equipa");
  const parsed = removeSchema.safeParse({ staffId: formData.get("staffId") });
  if (!parsed.success) redirect("/console/equipa?error=invalid");

  // Never remove yourself — a venue must not lock itself out.
  const self = await query<{ id: string }>(
    `select id from public.staff where id = $1 and user_id = $2`,
    [parsed.data.staffId, ctx.staff.userId],
  );
  if (self.rows.length > 0) redirect("/console/equipa?error=self");

  let venueId: string | null = null;
  try {
    const res = await query<{ venue_id: string }>(
      `delete from public.staff
        where id = $1 and venue_id = any($2::uuid[]) and role <> 'admin'
        returning venue_id`,
      [parsed.data.staffId, ctx.venues.map((v) => v.id)],
    );
    venueId = res.rows[0]?.venue_id ?? null;
  } catch {
    // FK: the staff member is referenced by sessions — history wins.
    redirect("/console/equipa?error=inUse");
  }
  if (venueId) {
    await audit(ctx, "staff.removed", "staff", parsed.data.staffId, venueId);
  }
  revalidatePath("/console/equipa");
  redirect("/console/equipa");
}
