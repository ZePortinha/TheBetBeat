import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { parseSessionConfig } from "@/lib/domain/config";
import { publicChannel, staffChannel } from "@/lib/realtime/events";
import { publishBroadcasts } from "@/lib/realtime/publish";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

/**
 * POST /api/cockpit/session/settings — live-adjustable session knobs
 * (B7 Definições): rhythm R, base price (clamped to ±30% of the venue's
 * base), catalog mode and the no-repeat window. Strict allowlist; every
 * accepted change is audited and broadcast as `price.changed` so open
 * guest quotes refresh.
 */
const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    acceptanceRatePerHour: z.number().int().min(1).max(60).optional(),
    basePriceCents: z.number().int().min(100).max(1_000_000).optional(),
    catalogMode: z.enum(["library", "library_plus_catalog"]).optional(),
    noRepeatWindowMin: z.number().int().min(0).max(240).optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError(400, "invalid_body");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_body");
  const body = parsed.data;

  const scope = await authorizeSession(auth.ctx, body.sessionId);
  if (!scope) return apiError(403, "forbidden");

  const now = Date.now();
  try {
    const result = await withTransaction(async (client) => {
      const venueRes = await client.query<{ settings: unknown }>(
        `select settings from public.venues where id = $1`,
        [scope.venueId],
      );
      const venueSettings =
        typeof venueRes.rows[0]?.settings === "object" && venueRes.rows[0]?.settings !== null
          ? (venueRes.rows[0].settings as Record<string, unknown>)
          : {};
      const venueBase =
        typeof venueSettings.basePriceCents === "number" &&
        Number.isSafeInteger(venueSettings.basePriceCents)
          ? venueSettings.basePriceCents
          : 1000;

      const patch: Record<string, number> = {};
      if (body.acceptanceRatePerHour !== undefined) {
        patch.acceptanceRatePerHour = body.acceptanceRatePerHour;
      }
      if (body.basePriceCents !== undefined) {
        // ±30% of the venue's base price — the venue's limits win (B7).
        const min = Math.round(venueBase * 0.7);
        const max = Math.round(venueBase * 1.3);
        patch.basePriceCents = Math.min(max, Math.max(min, body.basePriceCents));
      }
      if (body.noRepeatWindowMin !== undefined) {
        patch.noRepeatWindowMin = body.noRepeatWindowMin;
      }

      if (Object.keys(patch).length > 0) {
        await client.query(
          `insert into public.session_settings (session_id, config)
           values ($1, $2::jsonb)
           on conflict (session_id)
           do update set config = public.session_settings.config || $2::jsonb,
                         updated_at = now()`,
          [scope.sessionId, JSON.stringify(patch)],
        );
      }
      if (body.catalogMode !== undefined) {
        await client.query(
          `update public.sessions set catalog_mode = $2 where id = $1`,
          [scope.sessionId, body.catalogMode],
        );
      }

      await client.query(
        `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
         values ($1, 'session.settings_changed', 'session', $2, $3, $4)`,
        [
          auth.ctx.actor,
          scope.sessionId,
          scope.venueId,
          JSON.stringify({ ...patch, catalogMode: body.catalogMode ?? undefined }),
        ],
      );

      const configRes = await client.query<{ config: unknown }>(
        `select coalesce(config, '{}'::jsonb) as config
           from public.session_settings where session_id = $1`,
        [scope.sessionId],
      );
      return parseSessionConfig(configRes.rows[0]?.config ?? {});
    });

    // Pricing inputs changed — let clients requote (B11 price.changed).
    if (
      body.acceptanceRatePerHour !== undefined ||
      body.basePriceCents !== undefined
    ) {
      await publishBroadcasts(
        [
          {
            topic: staffChannel(scope.sessionId),
            event: "price.changed",
            payload: { sessionId: scope.sessionId },
            private: true,
          },
          {
            topic: publicChannel(scope.sessionId),
            event: "price.changed",
            payload: { sessionId: scope.sessionId },
            private: false,
          },
        ],
        now,
      );
    }

    return NextResponse.json({
      ok: true,
      config: {
        acceptanceRatePerHour: result.acceptanceRatePerHour,
        basePriceCents: result.basePriceCents,
        noRepeatWindowMin: result.noRepeatWindowMin,
      },
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:settings] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
