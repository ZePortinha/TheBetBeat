import { QueueScreen } from "@/components/cockpit/queue-screen";
import { resolveCockpitSession } from "../_lib/session";

export const dynamic = "force-dynamic";

/** Fila — the full queue with filters and the deadline timeline (B7). */
export default async function CockpitQueuePage() {
  const sessionId = await resolveCockpitSession("/cockpit/queue");
  return <QueueScreen sessionId={sessionId} />;
}
