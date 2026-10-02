"use server";

/**
 * Zonas & QR — CRUD (B9.2). Venue-scoped, zod strict, audited.
 * The QR token itself is signed at render time (lib/security/tokens);
 * nothing here ever persists a token.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

const createSchema = z
  .object({
    venueId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
  })
  .strict();

export async function createZoneAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/zonas");
  const parsed = createSchema.safeParse({
    venueId: formData.get("venueId"),
    name: formData.get("name"),
  });
  if (!parsed.success) redirect("/console/zonas?error=invalid");
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  const res = await query<{ id: string }>(
    `insert into public.zones (venue_id, name) values ($1, $2) returning id`,
    [venueId, parsed.data.name],
  );
  await audit(ctx, "zone.created", "zone", res.rows[0].id, venueId, {
    name: parsed.data.name,
  });
  revalidatePath("/console/zonas");
  redirect("/console/zonas");
}

const renameSchema = z
  .object({
    zoneId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
  })
  .strict();

export async function renameZoneAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/zonas");
  const parsed = renameSchema.safeParse({
    zoneId: formData.get("zoneId"),
    name: formData.get("name"),
  });
  if (!parsed.success) redirect("/console/zonas?error=invalid");

  // Scope: the zone must belong to a venue this user controls.
  const res = await query<{ venue_id: string }>(
    `update public.zones set name = $2
      where id = $1 and venue_id = any($3::uuid[])
      returning venue_id`,
    [parsed.data.zoneId, parsed.data.name, ctx.venues.map((v) => v.id)],
  );
  if (res.rows[0]) {
    await audit(ctx, "zone.renamed", "zone", parsed.data.zoneId, res.rows[0].venue_id, {
      name: parsed.data.name,
    });
  }
  revalidatePath("/console/zonas");
  redirect("/console/zonas");
}

const deleteSchema = z.object({ zoneId: z.string().uuid() }).strict();

export async function deleteZoneAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/zonas");
  const parsed = deleteSchema.safeParse({ zoneId: formData.get("zoneId") });
  if (!parsed.success) redirect("/console/zonas?error=invalid");

  let deletedVenueId: string | null = null;
  try {
    const res = await query<{ venue_id: string }>(
      `delete from public.zones
        where id = $1 and venue_id = any($2::uuid[])
        returning venue_id`,
      [parsed.data.zoneId, ctx.venues.map((v) => v.id)],
    );
    deletedVenueId = res.rows[0]?.venue_id ?? null;
  } catch {
    // FK violation: the zone already has quotes/requests — keep history intact.
    redirect("/console/zonas?error=inUse");
  }
  if (deletedVenueId) {
    await audit(ctx, "zone.deleted", "zone", parsed.data.zoneId, deletedVenueId);
  }
  revalidatePath("/console/zonas");
  redirect("/console/zonas");
}
