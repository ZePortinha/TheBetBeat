"use server";

/**
 * Admin BetBeat — Feature flags (B9 admin). Platform admins only.
 *
 * Writes ONLY allowlisted keys (flags.ts) into venues.settings: booleans
 * are set/removed, integers are bounds-checked or removed when blank.
 * Unknown form fields are rejected by the strict zod schema. Audited
 * with the exact patch applied.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { audit, requireAdminConsole } from "../../_lib/context";
import { BOOLEAN_CHOICES, FLAGS } from "./flags";

const shape: Record<string, z.ZodTypeAny> = { venueId: z.string().uuid() };
for (const flag of FLAGS) {
  shape[flag.key] =
    flag.kind === "boolean"
      ? z.enum(BOOLEAN_CHOICES)
      : z
          .string()
          .trim()
          .max(12)
          .regex(/^\d*$/)
          .transform((s) => (s === "" ? null : Number(s)))
          .refine(
            (n) =>
              n === null ||
              (Number.isSafeInteger(n) &&
                n >= (flag.min ?? 0) &&
                n <= (flag.max ?? Number.MAX_SAFE_INTEGER)),
            { message: "range" },
          );
}
const schema = z.object(shape).strict();

export async function saveFlagsAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminConsole("/console/admin/flags");
  const raw: Record<string, unknown> = { venueId: formData.get("venueId") };
  for (const flag of FLAGS) raw[flag.key] = formData.get(flag.key) ?? "";
  const parsed = schema.safeParse(raw);
  if (!parsed.success) redirect("/console/admin/flags?error=invalid");

  const venueId = parsed.data.venueId as string;
  const set: Record<string, boolean | number> = {};
  const unset: string[] = [];
  for (const flag of FLAGS) {
    const value = parsed.data[flag.key] as string | number | null;
    if (flag.kind === "boolean") {
      if (value === "inherit") unset.push(flag.key);
      else set[flag.key] = value === "on";
    } else if (value === null) {
      unset.push(flag.key);
    } else {
      set[flag.key] = value as number;
    }
  }

  const res = await query<{ id: string }>(
    `update public.venues
        set settings = (settings - $3::text[]) || $2::jsonb
      where id = $1
      returning id`,
    [venueId, JSON.stringify(set), unset],
  );
  if (!res.rows[0]) redirect("/console/admin/flags?error=invalid");

  await audit(ctx, "venue.flags_updated", "venue", venueId, venueId, { set, unset });
  revalidatePath("/console/admin/flags");
  redirect(`/console/admin/flags?saved=${venueId}`);
}
