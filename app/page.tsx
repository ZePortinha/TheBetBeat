import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signToken } from "@/lib/security/tokens";
import { BootIntro } from "@/components/ui/boot-intro";
import {
  DevStrip,
  Footer,
  Guarantee,
  Hero,
  How,
  LandingHeader,
  Sides,
} from "@/components/landing/landing";

export const dynamic = "force-dynamic";

/** Signed QR/display links from the seeded data — development only. */
async function devLinks(): Promise<{
  guestHref: string | null;
  displayHref: string | null;
}> {
  let guestHref: string | null = null;
  let displayHref: string | null = null;
  try {
    const supabase = createAdminClient();
    const { data: zone } = await supabase
      .from("zones")
      .select("qr_slug, venue_id")
      .eq("qr_slug", "zone-pista-dev")
      .single();
    const { data: session } = await supabase
      .from("sessions")
      .select("display_slug, venue_id")
      .eq("status", "live")
      .limit(1)
      .single();
    if (zone) {
      guestHref = `/s/${encodeURIComponent(
        signToken({ kind: "zone", venueId: zone.venue_id, slug: zone.qr_slug }),
      )}`;
    }
    if (session) {
      displayHref = `/display/${encodeURIComponent(
        signToken({
          kind: "display",
          venueId: session.venue_id,
          slug: session.display_slug,
        }),
      )}`;
    }
  } catch {
    // Database not up yet; the static links still render.
  }
  return { guestHref, displayHref };
}

export default async function Home() {
  const t = await getTranslations("common.landing");
  // The E2E suite reads these links off this page; production never shows them.
  const dev = process.env.NODE_ENV !== "production" ? await devLinks() : null;

  return (
    <div className="relative">
      <BootIntro />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-button focus:bg-accent-500 focus:px-4 focus:py-2 focus:text-text-on-accent"
      >
        {t("skip")}
      </a>
      <LandingHeader />
      <main id="main">
        <Hero />
        <How />
        <Sides />
        <Guarantee />
      </main>
      <Footer />
      {dev ? <DevStrip {...dev} /> : null}
    </div>
  );
}
