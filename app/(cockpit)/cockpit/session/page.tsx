import { StatsScreen } from "@/components/cockpit/stats-screen";
import { resolveCockpitSession } from "../_lib/session";

export const dynamic = "force-dynamic";

/** Sessão & Receita — revenue, acceptance, refunds, payout (B7). */
export default async function CockpitSessionPage() {
  const sessionId = await resolveCockpitSession("/cockpit/session");
  return <StatsScreen sessionId={sessionId} />;
}
