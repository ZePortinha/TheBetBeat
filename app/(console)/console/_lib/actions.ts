"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireConsole, VENUE_COOKIE } from "./context";

const schema = z.object({ venueId: z.string().uuid() });

/**
 * Venue switcher (admins see every venue; managers only their own).
 * The cookie is only ever set to a venue `requireConsole` authorized.
 */
export async function switchVenueAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ venueId: formData.get("venueId") });
  if (!parsed.success) redirect("/console");

  const ctx = await requireConsole("/console");
  if (!ctx.venues.some((v) => v.id === parsed.data.venueId)) {
    redirect("/console");
  }

  const store = await cookies();
  store.set(VENUE_COOKIE, parsed.data.venueId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/console",
  });
  redirect("/console");
}
