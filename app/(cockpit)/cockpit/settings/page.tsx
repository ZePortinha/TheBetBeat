import { SettingsScreen } from "@/components/cockpit/settings-screen";
import { resolveCockpitSession } from "../_lib/session";

export const dynamic = "force-dynamic";

/** Definições — live knobs, sounds, library import, end set (B7). */
export default async function CockpitSettingsPage() {
  const sessionId = await resolveCockpitSession("/cockpit/settings");
  return <SettingsScreen sessionId={sessionId} />;
}
