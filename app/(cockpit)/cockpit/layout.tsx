import type { Metadata } from "next";
import { requireStaff } from "@/lib/security/staff";
import { CockpitShell } from "@/components/cockpit/cockpit-shell";

/**
 * Cockpit server layout (BRIEF B7 + B12.3): staff roles enforced
 * server-side on EVERY request — the middleware gate is only the cheap
 * outer check. PWA manifest so the iPad installs the cockpit app.
 */
export const metadata: Metadata = {
  title: "Cockpit",
  manifest: "/manifest-cockpit.webmanifest",
  robots: { index: false, follow: false },
};

export default async function CockpitLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireStaff(["dj", "manager", "admin"], { nextPath: "/cockpit" });
  return <CockpitShell>{children}</CockpitShell>;
}
