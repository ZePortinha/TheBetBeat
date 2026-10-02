"use server";

/**
 * Análise (B9.6): the venue types tonight's occupancy ("lotação") so the
 * console can derive revenue per guest. Persisted on venues.settings.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

const schema = z
  .object({
    venueId: z.string().uuid(),
    occupancy: z.coerce.number().int().min(1).max(100_000),
    period: z.enum(["tonight", "7d", "30d"]).catch("tonight"),
  })
  .strict();

export async function saveOccupancyAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/analise");
  const parsed = schema.safeParse({
    venueId: formData.get("venueId"),
    occupancy: formData.get("occupancy"),
    period: formData.get("period") ?? "tonight",
  });
  if (!parsed.success) redirect("/console/analise");
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  await query(
    `update public.venues
        set settings = settings || jsonb_build_object('occupancy', $2::int)
      where id = $1`,
    [venueId, parsed.data.occupancy],
  );
  await audit(ctx, "venue.occupancy_updated", "venue", venueId, venueId, {
    occupancy: parsed.data.occupancy,
  });
  revalidatePath("/console/analise");
  redirect(`/console/analise?period=${parsed.data.period}`);
}
