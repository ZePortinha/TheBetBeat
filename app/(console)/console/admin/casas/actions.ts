"use server";

/**
 * Admin Discontrol — Casas & contratos (B9 admin). Platform admins only
 * (requireAdminConsole = requireStaff(['admin']) + venue_id-null check).
 * zod strict; every mutation audited.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { PLATFORM_FEE_BPS } from "@/lib/ledger/split";
import { audit, requireAdminConsole } from "../../_lib/context";

const feeSchema = z
  .object({
    venueId: z.string().uuid(),
    defaultVenueSharePct: z.coerce.number().finite().min(0).max(100),
  })
  .strict();

export async function updateVenueContractAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminConsole("/console/admin/casas");
  const parsed = feeSchema.safeParse({
    venueId: formData.get("venueId"),
    defaultVenueSharePct: formData.get("defaultVenueSharePct"),
  });
  if (!parsed.success) redirect("/console/admin/casas?error=invalid");

  // Discontrol's fee is flat (11%) since 2026-10-11: only the club's default share is editable.
  const feeBps = PLATFORM_FEE_BPS;
  const shareBps = Math.round(parsed.data.defaultVenueSharePct * 100);
  await query(
    `update public.venues
        set betbeat_fee_bps = $2,
            settings = settings || jsonb_build_object('defaultVenueShareBps', $3::int)
      where id = $1`,
    [parsed.data.venueId, feeBps, shareBps],
  );
  await audit(ctx, "venue.contract_updated", "venue", parsed.data.venueId, parsed.data.venueId, {
    betbeatFeeBps: feeBps,
    defaultVenueShareBps: shareBps,
  });
  revalidatePath("/console/admin/casas");
  redirect("/console/admin/casas");
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,60}$/),
  })
  .strict();

export async function createVenueAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminConsole("/console/admin/casas");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) redirect("/console/admin/casas?error=invalid");

  let createdId: string | null = null;
  try {
    const res = await query<{ id: string }>(
      `insert into public.venues (name, slug) values ($1, $2) returning id`,
      [parsed.data.name, parsed.data.slug],
    );
    createdId = res.rows[0]?.id ?? null;
  } catch {
    redirect("/console/admin/casas?error=slugTaken");
  }
  if (!createdId) redirect("/console/admin/casas?error=invalid");
  await audit(ctx, "venue.created", "venue", createdId, createdId, {
    name: parsed.data.name,
    slug: parsed.data.slug,
  });
  revalidatePath("/console/admin/casas");
  redirect("/console/admin/casas");
}
