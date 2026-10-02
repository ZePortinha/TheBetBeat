import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { DEFAULT_SESSION_CONFIG } from "@/lib/domain/types";
import { PageHeader } from "@/components/console/page-header";
import { SessionForm, type SessionFormValues } from "@/components/console/session-form";
import { requireConsole } from "../../_lib/context";
import { loadDjs, loadGenres, loadVenueFeeBps } from "../form-data";

export const dynamic = "force-dynamic";

export default async function NewSessionPage() {
  const ctx = await requireConsole("/console/sessoes/nova");
  const t = await getTranslations("console.sessions");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console/sessoes");

  const [djs, genres, feeBps] = await Promise.all([
    loadDjs(venue.id),
    loadGenres(venue.id),
    loadVenueFeeBps(venue.id),
  ]);

  const d = DEFAULT_SESSION_CONFIG;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
  }).format(new Date());

  const initial: SessionFormValues = {
    name: "",
    date: today,
    startTime: "23:00",
    endTime: "04:00",
    djStaffId: "",
    genres: [],
    catalogMode: "library",
    basePriceEur: d.basePriceCents / 100,
    acceptanceRatePerHour: d.acceptanceRatePerHour,
    soonDeadlineMin: d.soonDeadlineMin,
    nextDeadlineMin: d.nextDeadlineMin,
    queueMinEur: d.tierLimits.QUEUE.minCents / 100,
    queueMaxEur: d.tierLimits.QUEUE.maxCents / 100,
    soonMinEur: d.tierLimits.SOON.minCents / 100,
    soonMaxEur: d.tierLimits.SOON.maxCents / 100,
    nextMinEur: d.tierLimits.NEXT.minCents / 100,
    nextMaxEur: d.tierLimits.NEXT.maxCents / 100,
    venueSharePct: d.venueShareBps / 100,
  };

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: t("crumbRoot") },
          { label: t("title"), href: "/console/sessoes" },
          { label: t("new") },
        ]}
        title={t("new")}
      />
      <SessionForm
        venueId={venue.id}
        djs={djs}
        genreOptions={genres}
        betbeatFeePct={feeBps / 100}
        initial={initial}
      />
    </div>
  );
}
