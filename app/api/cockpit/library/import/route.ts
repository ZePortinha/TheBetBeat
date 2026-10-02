import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import {
  ImportError,
  MAX_IMPORT_BYTES,
  parseLibraryCsv,
  parseRekordboxXml,
  type ImportResult,
} from "@/lib/catalog/import";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

/**
 * POST /api/cockpit/library/import — multipart DJ library upload
 * (B4.6 + B12.4 uploads): 10 MB cap enforced server-side BEFORE reading
 * the body into memory where possible, real type sniffed from content
 * (never the filename): XML must start with '<' and contain
 * DJ_PLAYLISTS; otherwise it must be a CSV with the expected header.
 * Parsing happens in lib/catalog/import (DTD/entity-free XML scan).
 */

const fieldsSchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;

  // Cheap outer cap: reject oversized bodies by header before parsing.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMPORT_BYTES + 64 * 1024) {
    return apiError(413, "too_large");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_body");
  }
  const parsedFields = fieldsSchema.safeParse({
    sessionId: form.get("sessionId") ?? undefined,
  });
  if (!parsedFields.success) return apiError(400, "invalid_body");

  const scope = await authorizeSession(auth.ctx, parsedFields.data.sessionId);
  if (!scope) return apiError(403, "forbidden");

  const file = form.get("file");
  if (!(file instanceof Blob)) return apiError(400, "invalid_body");
  if (file.size > MAX_IMPORT_BYTES) return apiError(413, "too_large");

  const text = await file.text();

  // Content sniff (B12.4): the real type comes from the bytes.
  const head = text.slice(0, 4096);
  const trimmed = head.trimStart();
  let result: ImportResult;
  try {
    if (trimmed.startsWith("<")) {
      if (!/DJ_PLAYLISTS/i.test(text)) return apiError(400, "unrecognized_file");
      result = parseRekordboxXml(text);
    } else {
      result = parseLibraryCsv(text);
    }
  } catch (error) {
    if (error instanceof ImportError) {
      return apiError(error.code === "TOO_LARGE" ? 413 : 400, "unrecognized_file");
    }
    throw error;
  }

  if (result.tracks.length === 0) {
    return NextResponse.json({ ok: true, imported: 0, skipped: result.skipped });
  }

  try {
    const imported = await withTransaction(async (client) => {
      let count = 0;
      // Batched parameterized inserts (500 tracks per statement).
      const BATCH = 500;
      for (let i = 0; i < result.tracks.length; i += BATCH) {
        const slice = result.tracks.slice(i, i + BATCH);
        const values: string[] = [];
        const params: unknown[] = [scope.venueId];
        slice.forEach((t, j) => {
          const base = 1 + j * 6;
          values.push(
            `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
          );
          params.push(
            t.title,
            t.artist,
            t.genre ?? "unknown",
            t.bpm,
            t.camelotKey,
            t.durationSec,
          );
        });
        const res = await client.query(
          `insert into public.library_tracks
             (venue_id, title, artist, genre, bpm, camelot_key, duration_sec)
           values ${values.join(", ")}`,
          params,
        );
        count += res.rowCount ?? 0;
      }
      await client.query(
        `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
         values ($1, 'library.imported', 'venue', $2, $2, $3)`,
        [
          auth.ctx.actor,
          scope.venueId,
          JSON.stringify({ imported: count, skipped: result.skipped }),
        ],
      );
      return count;
    });

    return NextResponse.json({ ok: true, imported, skipped: result.skipped });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:import] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
