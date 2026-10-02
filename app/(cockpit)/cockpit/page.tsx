import { LiveScreen } from "@/components/cockpit/live-screen";
import { resolveCockpitSession } from "./_lib/session";

export const dynamic = "force-dynamic";

/** Ao Vivo — the cockpit's default screen (BRIEF B7). */
export default async function CockpitLivePage() {
  const sessionId = await resolveCockpitSession("/cockpit");
  return <LiveScreen sessionId={sessionId} />;
}
