import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { X } from "lucide-react";
import { query } from "@/lib/db";
import { decrypt, maskPhone } from "@/lib/security/crypto";
import { env } from "@/lib/security/env";
import { signToken } from "@/lib/security/tokens";
import { parseSessionConfig } from "@/lib/domain/config";
import { Chip } from "@/components/ui/fit-chip";
import { CopyButton } from "@/components/console/copy-button";
import { EventQr } from "@/components/console/event-qr";
import { GuestListForm } from "@/components/console/guest-list-form";
import { PageHeader } from "@/components/console/page-header";
import { SessionForm, type SessionFormValues } from "@/components/console/session-form";
import { formatDateTime, requireConsole } from "../../_lib/context";
import { endSessionAction, removeGuestListAction } from "../actions";
import { lisbonParts, loadDjs, loadGenres, loadVenueFeeBps } from "../form-data";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const ctx = await requireConsole(`/console/sessoes/${id}`);
  const t = await getTranslations("console.sessions");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console/sessoes");

  // Venue-scoped fetch: a manager can never open another venue's session.
  const res = await query<{
    id: string;
    name: string;
    status: "scheduled" | "live" | "paused" | "ended";
    genres: string[];
    catalog_mode: "library" | "library_plus_catalog";
    starts_at: string;
    ends_at: string;
    dj_staff_id: string | null;
    display_slug: string;
    config: unknown;
    venue_share_bps: number;
  }>(
    `select s.id, s.name, s.status, s.genres, s.catalog_mode, s.starts_at,
            s.ends_at, s.dj_staff_id, s.display_slug,
            coalesce(ss.config, '{}'::jsonb) as config,
            coalesce(ss.venue_share_bps, 5000) as venue_share_bps
       from public.sessions s
       left join public.session_settings ss on ss.session_id = s.id
      where s.id = $1 and s.venue_id = $2`,
    [id, venue.id],
  );
  const session = res.rows[0];
  if (!session) notFound();

  const [djs, genres, feeBps, guestListRes] = await Promise.all([
    loadDjs(venue.id),
    loadGenres(venue.id),
    loadVenueFeeBps(venue.id),
    query<{ id: string; phone_encrypted: string }>(
      `select id, phone_encrypted from public.session_guest_list
        where session_id = $1 order by created_at desc`,
      [session.id],
    ),
  ]);
  // Staff see masked numbers only (B12.5 data minimization).
  const guestList = guestListRes.rows.map((r) => ({
    id: r.id,
    masked: maskPhone(decrypt(r.phone_encrypted)),
  }));
  const config = parseSessionConfig(session.config);
  const start = lisbonParts(session.starts_at);
  const end = lisbonParts(session.ends_at);

  const displayUrl = `${env.NEXT_PUBLIC_APP_URL}/display/${signToken({
    kind: "display",
    venueId: venue.id,
    slug: session.display_slug,
  })}`;

  // The event's own QR: opens this event only (not the next night at the venue).
  const eventUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${signToken({ kind: "session", venueId: venue.id, slug: session.id })}`;

  const initial: SessionFormValues = {
    sessionId: session.id,
    name: session.name,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    djStaffId: session.dj_staff_id ?? "",
    genres: session.genres,
    catalogMode: session.catalog_mode,
    basePriceEur: config.basePriceCents / 100,
    acceptanceRatePerHour: config.acceptanceRatePerHour,
    soonDeadlineMin: config.soonDeadlineMin,
    nextDeadlineMin: config.nextDeadlineMin,
    queueMinEur: config.tierLimits.QUEUE.minCents / 100,
    queueMaxEur: config.tierLimits.QUEUE.maxCents / 100,
    soonMinEur: config.tierLimits.SOON.minCents / 100,
    soonMaxEur: config.tierLimits.SOON.maxCents / 100,
    nextMinEur: config.tierLimits.NEXT.minCents / 100,
    nextMaxEur: config.tierLimits.NEXT.maxCents / 100,
    venueSharePct: session.venue_share_bps / 100,
  };

  const live = session.status === "live" || session.status === "paused";

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: t("crumbRoot") },
          { label: t("title"), href: "/console/sessoes" },
          { label: session.name },
        ]}
        title={session.name}
        actions={
          live ? (
            <form action={endSessionAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button
                type="submit"
                data-testid="session-end-button"
                className="min-h-11 rounded-button bg-ember-700 px-5 text-base
                  font-semibold text-text-on-accent transition-transform duration-100
                  active:scale-[0.97]"
              >
                {t("end")}
              </button>
            </form>
          ) : undefined
        }
      />

      <section className="mb-8 flex flex-col gap-3 rounded-card border border-line-subtle bg-surface-1 p-6">
        <div className="flex items-center gap-3">
          <Chip tone={live ? "ember" : "neutral"}>{t(`status.${session.status}`)}</Chip>
          <span className="text-sm text-text-secondary tnum">
            {formatDateTime(session.starts_at)} — {formatDateTime(session.ends_at)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-secondary">{t("displayLink")}</p>
          <code
            data-testid="session-display-link"
            className="max-w-xl truncate rounded-chip bg-surface-3 px-2 py-1 text-xs text-text-primary"
          >
            {displayUrl}
          </code>
          <CopyButton
            value={displayUrl}
            label={t("copyLink")}
            copiedLabel={t("copied")}
          />
        </div>
        {session.status === "ended" && (
          <Link
            href={`/console/receita/${session.id}`}
            data-testid="session-statement-link"
            className="self-start text-sm font-semibold text-accent-400 hover:text-accent-300"
          >
            {t("viewStatement")}
          </Link>
        )}
      </section>

      {session.status !== "ended" ? <EventQr url={eventUrl} fileName={`qr-${session.name}`} /> : null}

      <section
        data-testid="guest-list"
        className="mb-8 flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6"
      >
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t("guestList.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">{t("guestList.hint")}</p>
        </div>
        {session.status !== "ended" ? <GuestListForm sessionId={session.id} /> : null}
        <p className="label text-text-tertiary">
          {t("guestList.count", { count: guestList.length })}
        </p>
        {guestList.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {guestList.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-chip bg-surface-2 py-1 pl-3 pr-1"
              >
                <span className="tnum text-sm text-text-primary">{entry.masked}</span>
                {session.status !== "ended" ? (
                  <form action={removeGuestListAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <input type="hidden" name="entryId" value={entry.id} />
                    <button
                      type="submit"
                      aria-label={t("guestList.removeLabel", { phone: entry.masked })}
                      className="flex size-9 items-center justify-center rounded-chip text-text-tertiary transition-colors hover:bg-surface-3 hover:text-ember-500"
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {session.status !== "ended" ? (
        <SessionForm
          venueId={venue.id}
          djs={djs}
          genreOptions={genres}
          betbeatFeePct={feeBps / 100}
          initial={initial}
        />
      ) : (
        <p className="text-sm text-text-tertiary">{t("endedReadOnly")}</p>
      )}
    </div>
  );
}
