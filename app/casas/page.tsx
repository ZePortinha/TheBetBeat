import { getTranslations } from "next-intl/server";
import { Footer, Guarantee, Hero, How, LandingHeader, Sides } from "@/components/landing/landing";

/** /casas — BetBeat for clubs (the marketing landing; "/" is the guests' front door). */
export default async function ForVenues() {
  const t = await getTranslations("common.landing");
  return (
    <div className="relative">
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
    </div>
  );
}
