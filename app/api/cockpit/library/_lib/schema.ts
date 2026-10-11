import { z } from "zod";
import type { LibraryTrackInput } from "@/lib/catalog/library";

/** One song typed by the DJ (strict allowlist; venue checked separately). */
export const trackFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    artist: z.string().trim().min(1).max(160),
    album: z.string().trim().max(120).nullable().optional(),
    genre: z.string().trim().min(1).max(64),
    bpm: z.number().min(40).max(250).nullable().optional(),
    camelotKey: z.string().trim().max(4).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    durationSec: z.number().int().min(1).max(7200).nullable().optional(),
  })
  .strict();

export function toTrackInput(data: z.infer<typeof trackFieldsSchema>): LibraryTrackInput {
  return {
    title: data.title,
    artist: data.artist,
    album: data.album ? data.album : null,
    genre: data.genre,
    bpm: data.bpm === null || data.bpm === undefined ? null : Math.round(data.bpm * 10) / 10,
    camelotKey: data.camelotKey ? data.camelotKey : null,
    year: data.year ?? null,
    durationSec: data.durationSec ?? null,
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function audit(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  actor: string,
  action: string,
  venueId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
     values ($1, $2, 'venue', $3::text, $3::uuid, $4)`,
    [actor, action, venueId, JSON.stringify(payload)],
  );
}

export function correlationId(): string {
  return Math.random().toString(16).slice(2, 10);
}
