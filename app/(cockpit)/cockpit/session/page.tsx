import { getPool } from "@/lib/db";
import { env } from "@/lib/security/env";
import { signToken } from "@/lib/security/tokens";
import { EventQr } from "@/components/console/event-qr";
import { StatsScreen } from "@/components/cockpit/stats-screen";
import { resolveCockpitSession } from "../_lib/session";

export const dynamic = "force-dynamic";

/** Sessão & Receita — revenue, acceptance, refunds, payout (B7) + the event QR for the DJ to share. */
export default async function CockpitSessionPage() {
  const sessionId = await resolveCockpitSession("/cockpit/session");
  const event = sessionId
    ? (await getPool().query<{ venue_id: string; name: string }>(`select venue_id, name from public.sessions where id = $1`, [sessionId])).rows[0]
    : undefined;
  return (
    <StatsScreen
      sessionId={sessionId}
      footer={
        event && sessionId ? (
          <EventQr
            url={`${env.NEXT_PUBLIC_APP_URL}/s/${signToken({ kind: "session", venueId: event.venue_id, slug: sessionId })}`}
            fileName={`qr-${event.name}`}
          />
        ) : null
      }
    />
  );
}
