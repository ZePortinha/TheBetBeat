import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { BarChart } from "@/components/console/bar-chart";
import { PageHeader } from "@/components/console/page-header";
import { Stat } from "@/components/console/stat";
import { formatEuros, oneDecimal, requireConsole } from "../_lib/context";
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
 * rows. Since the slot auctions (2026-10-05) every number comes from the
 * auctions closed in the period (auction_slot_metrics); revenue = money
 * behind winners that played. Per-slot detail lives in Console › Leilões.
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

  const [totalsRes, phaseRes, hourRes, refundRes, venueRes] = await Promise.all([
    // Funnel and KPIs over the auctions that closed in the period.
    query<{
      closed: string;
      with_bids: string;
      won: string;
      played: string;
      revenue: string;
      avg_bidders: string | null;
    }>(
      `select count(*)::bigint as closed,
              count(*) filter (where bids > 0)::bigint as with_bids,
              count(*) filter (where outcome = 'won')::bigint as won,
              count(*) filter (where play_status = 'played')::bigint as played,
              coalesce(sum(revenue_cents), 0)::bigint as revenue,
              avg(bidders) filter (where bids > 0) as avg_bidders
         from public.auction_slot_metrics
        where venue_id = $1 and status = 'closed' and closes_at >= now() - $2::interval`,
      [venue.id, interval],
    ),
    // Per phase of the night.
    query<{ phase: string; closed: string; won: string; avg_final: string | null; revenue: string }>(
      `select phase, count(*)::bigint as closed,
              count(*) filter (where outcome = 'won')::bigint as won,
              avg(final_price_cents) filter (where outcome = 'won') as avg_final,
              coalesce(sum(revenue_cents), 0)::bigint as revenue
         from public.auction_slot_metrics
        where venue_id = $1 and status = 'closed' and closes_at >= now() - $2::interval
        group by phase`,
      [venue.id, interval],
    ),
    // Revenue by hour of the close (Lisbon wall-clock).
    query<{ hour: number; revenue: string }>(
      `select extract(hour from closes_at at time zone 'Europe/Lisbon')::int as hour,
              coalesce(sum(revenue_cents), 0)::bigint as revenue
         from public.auction_slot_metrics
        where venue_id = $1 and play_status = 'played' and closes_at >= now() - $2::interval
        group by 1 order by 1`,
      [venue.id, interval],
    ),
    // Refunds by reason (auction wallets and any older tier request).
    query<{ reason: string; n: string; amount: string }>(
      `select split_part(rf.reason, ':', 1) as reason, count(*)::bigint as n,
              coalesce(sum(rf.amount_cents), 0)::bigint as amount
         from public.refunds rf
         join public.payments p on p.id = rf.payment_id
         left join public.requests r on r.id = rf.request_id
        where coalesce(p.venue_id, r.venue_id) = $1 and rf.created_at >= now() - $2::interval
        group by 1
        order by n desc`,
      [venue.id, interval],
    ),
    query<{ settings: { occupancy?: number } }>(
      `select settings from public.venues where id = $1`,
      [venue.id],
    ),
  ]);

  const totals = totalsRes.rows[0];
  const closed = Number(totals?.closed ?? 0);
  const withBids = Number(totals?.with_bids ?? 0);
  const won = Number(totals?.won ?? 0);
  const played = Number(totals?.played ?? 0);
  const totalRevenue = Number(totals?.revenue ?? 0);
  const avgBidders = totals?.avg_bidders ? Number(totals.avg_bidders) : null;
  const occupancy = venueRes.rows[0]?.settings?.occupancy ?? 0;

  const funnelStages: Array<[string, number]> = [
    [t("funnel.closed"), closed],
    [t("funnel.withBids"), withBids],
    [t("funnel.won"), won],
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
    "text-sm text-text-primary tnum focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

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
                      ? "bg-surface-3 font-semibold text-accent-300"
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
            label={t("wonRate")}
            value={closed > 0 ? `${Math.round((won / closed) * 100)}%` : "—"}
            hint={t("wonRateHint")}
          />
          <Stat
            label={t("bidders")}
            value={avgBidders === null ? "—" : oneDecimal(avgBidders)}
            hint={t("biddersHint")}
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
                    className="h-full rounded-chip bg-accent-500/80"
                    style={{ width: `${(n / funnelMax) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm font-semibold text-text-primary tnum">
                  {n}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <h2 className="pb-4 text-lg font-semibold text-text-primary">
            {t("byPhase.title")}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-subtle text-text-tertiary">
                <th className="label py-2 text-left">{t("byPhase.phase")}</th>
                <th className="label py-2 text-right">{t("byPhase.closed")}</th>
                <th className="label py-2 text-right">{t("byPhase.won")}</th>
                <th className="label py-2 text-right">{t("byPhase.avgFinal")}</th>
                <th className="label py-2 text-right">{t("byPhase.revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {(["warmup", "ramp", "peak", "close"] as const).map((phase) => {
                const row = phaseRes.rows.find((r) => r.phase === phase);
                return (
                  <tr key={phase} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 font-semibold text-text-primary">{t(`phases.${phase}`)}</td>
                    <td className="py-2 text-right text-text-primary tnum">{Number(row?.closed ?? 0)}</td>
                    <td className="py-2 text-right text-text-secondary tnum">{Number(row?.won ?? 0)}</td>
                    <td className="py-2 text-right text-text-secondary tnum">
                      {row?.avg_final ? formatEuros(Math.round(Number(row.avg_final))) : "—"}
                    </td>
                    <td className="py-2 text-right text-accent-400 tnum">{formatEuros(Number(row?.revenue ?? 0))}</td>
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
        <BarChart bars={bars} title={t("revenueByHour")} emptyLabel={t("noRevenue")} />
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
              className="min-h-10 rounded-button bg-accent-500 px-4 text-sm font-semibold
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
