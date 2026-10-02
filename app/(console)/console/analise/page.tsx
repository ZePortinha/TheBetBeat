import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { BarChart } from "@/components/console/bar-chart";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { formatEuros, requireConsole } from "../_lib/context";
import { saveOccupancyAction } from "./actions";

export const dynamic = "force-dynamic";

type Period = "tonight" | "7d" | "30d";
const PERIODS: Record<Period, string> = {
  tonight: "12 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/**
 * Análise (B9.6) — server-aggregated DTOs only; the page never ships raw
 * rows. "Scan" is proxied by distinct guests that produced a quote at
 * this venue (anonymous guest sessions are global, not venue-tagged).
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireConsole("/console/analise");
  const t = await getTranslations("console.analytics");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  const sp = await searchParams;
  const period: Period = sp.period === "7d" || sp.period === "30d" ? sp.period : "tonight";
  const interval = PERIODS[period];

  const [funnelRes, tierRes, hourRes, acceptRes, refundRes, venueRes] =
    await Promise.all([
      // Funnel: scans (distinct guests with quotes) → quotes → payments → played.
      query<{
        scans: string;
        quotes: string;
        paid: string;
        played: string;
      }>(
        `with q as (
           select guest_id, id from public.quotes
            where session_id in (select id from public.sessions where venue_id = $1)
              and created_at >= now() - $2::interval
         ),
         r as (
           select * from public.requests
            where venue_id = $1 and created_at >= now() - $2::interval
         )
         select
           (select count(distinct guest_id) from q)::bigint as scans,
           (select count(*) from q)::bigint as quotes,
           (select count(*) from r where paid_at is not null)::bigint as paid,
           (select count(*) from r where status = 'played')::bigint as played`,
        [venue.id, interval],
      ),
      // Conversion by tier: paid requests per tier over the quote volume.
      query<{ tier: string; paid: string; played: string }>(
        `select tier::text,
                count(*) filter (where paid_at is not null)::bigint as paid,
                count(*) filter (where status = 'played')::bigint as played
           from public.requests
          where venue_id = $1 and created_at >= now() - $2::interval
          group by tier
          order by tier`,
        [venue.id, interval],
      ),
      // Revenue by hour (Lisbon wall-clock).
      query<{ hour: number; revenue: string }>(
        `select extract(hour from paid_at at time zone 'Europe/Lisbon')::int as hour,
                coalesce(sum(amount_cents - refunded_cents), 0)::bigint as revenue
           from public.requests
          where venue_id = $1 and paid_at >= now() - $2::interval
          group by 1 order by 1`,
        [venue.id, interval],
      ),
      // Acceptance: DJ accepted over paid-and-decided.
      query<{ paid: string; accepted: string }>(
        `select count(*) filter (where paid_at is not null)::bigint as paid,
                count(*) filter (where accepted_at is not null)::bigint as accepted
           from public.requests
          where venue_id = $1 and created_at >= now() - $2::interval`,
        [venue.id, interval],
      ),
      // Refunds by reason.
      query<{ reason: string; n: string; amount: string }>(
        `select rf.reason, count(*)::bigint as n,
                coalesce(sum(rf.amount_cents), 0)::bigint as amount
           from public.refunds rf
           join public.requests r on r.id = rf.request_id
          where r.venue_id = $1 and rf.created_at >= now() - $2::interval
          group by rf.reason
          order by n desc`,
        [venue.id, interval],
      ),
      query<{ settings: { occupancy?: number } }>(
        `select settings from public.venues where id = $1`,
        [venue.id],
      ),
    ]);

  const funnel = funnelRes.rows[0];
  const scans = Number(funnel?.scans ?? 0);
  const quotes = Number(funnel?.quotes ?? 0);
  const paid = Number(funnel?.paid ?? 0);
  const played = Number(funnel?.played ?? 0);

  const totalRevenue = hourRes.rows.reduce((sum, r) => sum + Number(r.revenue), 0);
  const occupancy = venueRes.rows[0]?.settings?.occupancy ?? 0;

  const accept = acceptRes.rows[0];
  const acceptancePct =
    Number(accept?.paid ?? 0) > 0
      ? Math.round((Number(accept?.accepted ?? 0) / Number(accept?.paid)) * 100)
      : null;

  const funnelStages: Array<[string, number]> = [
    [t("funnel.scan"), scans],
    [t("funnel.quote"), quotes],
    [t("funnel.paid"), paid],
    [t("funnel.played"), played],
  ];
  const funnelMax = Math.max(1, ...funnelStages.map(([, n]) => n));

  const revenueByHour = new Map(hourRes.rows.map((r) => [r.hour, Number(r.revenue)]));
  // Night-ordered hours: 17:00 → 16:00 next day reads like a club night.
  const hours = Array.from({ length: 24 }, (_, i) => (17 + i) % 24);
  const bars = hours.map((h) => ({
    label: String(h).padStart(2, "0"),
    value: revenueByHour.get(h) ?? 0,
    display: formatEuros(revenueByHour.get(h) ?? 0),
  }));

  const inputCls =
    "w-28 rounded-button border border-line-subtle bg-surface-3 px-3 py-2 " +
    "text-sm text-text-primary tnum focus:border-gold-500 focus:outline-none";

  return (
    <div className="flex flex-col gap-10">
      <div>
        <PageHeader
          crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
          title={t("title")}
          actions={
            <nav aria-label={t("period.label")} className="flex gap-1 rounded-button border border-line-subtle bg-surface-1 p-1">
              {(Object.keys(PERIODS) as Period[]).map((p) => (
                <Link
                  key={p}
                  href={`/console/analise?period=${p}`}
                  aria-current={p === period ? "page" : undefined}
                  className={`rounded-chip px-3 py-1.5 text-sm ${
                    p === period
                      ? "bg-surface-3 font-semibold text-gold-500"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {t(`period.${p}`)}
                </Link>
              ))}
            </nav>
          }
        />
        <div className="grid grid-cols-4 gap-4">
          <Stat label={t("revenue")} value={formatEuros(totalRevenue)} money />
          <Stat
            label={t("acceptance")}
            value={acceptancePct === null ? "—" : `${acceptancePct}%`}
            hint={t("acceptanceHint")}
          />
          <Stat
            label={t("conversion")}
            value={quotes > 0 ? `${Math.round((paid / quotes) * 100)}%` : "—"}
            hint={t("conversionHint")}
          />
          <Stat
            label={t("revenuePerGuest")}
            value={occupancy > 0 ? formatEuros(Math.round(totalRevenue / occupancy)) : "—"}
            hint={occupancy > 0 ? t("occupancySet", { occupancy }) : t("occupancyUnset")}
            money
          />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-8">
        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <h2 className="pb-4 text-lg font-semibold text-text-primary">
            {t("funnel.title")}
          </h2>
          <div className="flex flex-col gap-3">
            {funnelStages.map(([label, n]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-40 text-sm text-text-secondary">{label}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-chip bg-surface-2">
                  <div
                    className="h-full rounded-chip bg-gold-500/80"
                    style={{ width: `${(n / funnelMax) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm font-semibold text-text-primary tnum">
                  {n}
                </span>
              </div>
            ))}
          </div>
          <p className="pt-3 text-xs text-text-tertiary">{t("funnel.scanNote")}</p>
        </div>

        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <h2 className="pb-4 text-lg font-semibold text-text-primary">
            {t("byTier.title")}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-subtle text-text-tertiary">
                <th className="label py-2 text-left">{t("byTier.tier")}</th>
                <th className="label py-2 text-right">{t("byTier.paid")}</th>
                <th className="label py-2 text-right">{t("byTier.played")}</th>
                <th className="label py-2 text-right">{t("byTier.conversion")}</th>
              </tr>
            </thead>
            <tbody>
              {(["QUEUE", "SOON", "NEXT"] as const).map((tier) => {
                const row = tierRes.rows.find((r) => r.tier === tier);
                const tierPaid = Number(row?.paid ?? 0);
                return (
                  <tr key={tier} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 font-semibold text-text-primary">
                      {t(`tiers.${tier}`)}
                    </td>
                    <td className="py-2 text-right text-text-primary tnum">{tierPaid}</td>
                    <td className="py-2 text-right text-text-secondary tnum">
                      {Number(row?.played ?? 0)}
                    </td>
                    <td className="py-2 text-right text-text-secondary tnum">
                      {quotes > 0 ? `${Math.round((tierPaid / quotes) * 100)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-card border border-line-subtle bg-surface-1 p-5">
        <h2 className="pb-4 text-lg font-semibold text-text-primary">
          {t("revenueByHour")}
        </h2>
        <BarChart bars={bars} title={t("revenueByHour")} />
      </section>

      <section className="grid grid-cols-2 gap-8">
        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <h2 className="pb-4 text-lg font-semibold text-text-primary">
            {t("refundsByReason")}
          </h2>
          {refundRes.rows.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t("noRefunds")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {refundRes.rows.map((r) => (
                  <tr key={r.reason} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-text-secondary">
                      {t.has(`refundReason.${r.reason}`)
                        ? t(`refundReason.${r.reason}`)
                        : r.reason}
                    </td>
                    <td className="py-2 text-right text-text-primary tnum">{Number(r.n)}</td>
                    <td className="py-2 text-right text-text-secondary tnum">
                      {formatEuros(Number(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <h2 className="pb-2 text-lg font-semibold text-text-primary">
            {t("occupancyTitle")}
          </h2>
          <p className="pb-4 text-sm text-text-tertiary">{t("occupancyHint")}</p>
          <form action={saveOccupancyAction} className="flex items-end gap-3">
            <input type="hidden" name="venueId" value={venue.id} />
            <input type="hidden" name="period" value={period} />
            <label className="flex flex-col gap-1.5">
              <span className="label text-text-secondary">{t("occupancyLabel")}</span>
              <input
                type="number"
                name="occupancy"
                min={1}
                max={100000}
                defaultValue={occupancy > 0 ? occupancy : undefined}
                required
                className={inputCls}
              />
            </label>
            <button
              type="submit"
              className="min-h-10 rounded-button bg-gold-500 px-4 text-sm font-semibold
                text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
            >
              {t("occupancySave")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
