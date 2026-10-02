import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/db";
import { DEFAULT_SESSION_CONFIG } from "@/lib/domain/types";
import { PageHeader } from "@/components/console/page-header";
import { Simulator } from "@/components/console/simulator";
import {
  TierDefaultsForm,
  type TierDefaultsValues,
} from "@/components/console/tier-defaults-form";
import { formatEuros, requireConsole } from "../_lib/context";
import { approveGenreAction, adjustGenreAction, toggleAutoApplyAction } from "./actions";

export const dynamic = "force-dynamic";

interface GenreMetricsJson {
  total?: number;
  converted?: number;
  conversion?: number;
  demand?: number;
  reason?: string;
}

export default async function PricingPage() {
  const ctx = await requireConsole("/console/precos");
  const t = await getTranslations("console.pricing");
  const venue = ctx.activeVenue;
  if (!venue) redirect("/console");

  const [venueRow, genreRows, revenueRows] = await Promise.all([
    query<{ settings: { sessionDefaults?: Record<string, unknown> } }>(
      `select settings from public.venues where id = $1`,
      [venue.id],
    ),
    query<{
      genre: string;
      multiplier: string;
      recommended: string | null;
      auto_apply: boolean;
      metrics: GenreMetricsJson;
    }>(
      `select genre, multiplier, recommended, auto_apply, metrics
         from public.genre_multipliers
        where venue_id = $1
        order by genre asc`,
      [venue.id],
    ),
    // Revenue per genre, last 30 days (B5.4 "receita") — server aggregate.
    query<{ genre: string; revenue_cents: string }>(
      `select coalesce(r.track_genre, '?') as genre,
              coalesce(sum(r.amount_cents - r.refunded_cents), 0)::bigint as revenue_cents
         from public.requests r
        where r.venue_id = $1
          and r.paid_at >= now() - interval '30 days'
        group by 1`,
      [venue.id],
    ),
  ]);

  const revenueByGenre = new Map(
    revenueRows.rows.map((r) => [r.genre, Number(r.revenue_cents)]),
  );

  const d = DEFAULT_SESSION_CONFIG;
  const stored = (venueRow.rows[0]?.settings?.sessionDefaults ?? {}) as {
    basePriceCents?: number;
    tierLimits?: Partial<
      Record<"QUEUE" | "SOON" | "NEXT", { minCents?: number; maxCents?: number }>
    >;
  };
  const limitFor = (tier: "QUEUE" | "SOON" | "NEXT") => ({
    minCents: stored.tierLimits?.[tier]?.minCents ?? d.tierLimits[tier].minCents,
    maxCents: stored.tierLimits?.[tier]?.maxCents ?? d.tierLimits[tier].maxCents,
  });
  const tierLimits = {
    QUEUE: limitFor("QUEUE"),
    SOON: limitFor("SOON"),
    NEXT: limitFor("NEXT"),
  };
  const defaults: TierDefaultsValues = {
    basePriceEur: (stored.basePriceCents ?? d.basePriceCents) / 100,
    queueMinEur: tierLimits.QUEUE.minCents / 100,
    queueMaxEur: tierLimits.QUEUE.maxCents / 100,
    soonMinEur: tierLimits.SOON.minCents / 100,
    soonMaxEur: tierLimits.SOON.maxCents / 100,
    nextMinEur: tierLimits.NEXT.minCents / 100,
    nextMaxEur: tierLimits.NEXT.maxCents / 100,
  };
  const basePriceCents = stored.basePriceCents ?? d.basePriceCents;

  const inputCls =
    "w-20 rounded-button border border-line-subtle bg-surface-3 px-2 py-1.5 " +
    "text-sm text-text-primary tnum focus:border-gold-500 focus:outline-none";

  return (
    <div className="flex flex-col gap-10">
      <div>
        <PageHeader
          crumbs={[{ label: t("crumbRoot") }, { label: t("title") }]}
          title={t("title")}
        />
        <TierDefaultsForm venueId={venue.id} initial={defaults} />
      </div>

      <section>
        <h2 className="pb-1 text-lg font-semibold text-text-primary">
          {t("genres.title")}
        </h2>
        <p className="pb-4 text-sm text-text-tertiary">{t("genres.hint")}</p>
        <div className="overflow-hidden rounded-card border border-line-subtle">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-subtle bg-surface-1 text-text-tertiary">
                <th className="label px-4 py-3">{t("genres.genre")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.current")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.recommended")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.conversion")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.volume")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.revenue")}</th>
                <th className="label px-4 py-3">{t("genres.reason")}</th>
                <th className="label px-4 py-3 text-right">{t("genres.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {genreRows.rows.map((row) => {
                const multiplier = Number(row.multiplier);
                const recommended =
                  row.recommended === null ? null : Number(row.recommended);
                const metrics = row.metrics ?? {};
                const reasonKey = metrics.reason ?? "none";
                return (
                  <tr key={row.genre} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-text-primary">{row.genre}</p>
                      <p className="text-xs text-text-tertiary tnum">
                        {t("genres.recommendedPrice", {
                          price: formatEuros(Math.round(basePriceCents * multiplier)),
                        })}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right text-text-primary tnum">
                      ×{multiplier.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary tnum">
                      {recommended === null ? "—" : `×${recommended.toFixed(2)}`}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary tnum">
                      {metrics.conversion === undefined
                        ? "—"
                        : `${Math.round(metrics.conversion * 100)}%`}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary tnum">
                      {metrics.total ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary tnum">
                      {formatEuros(revenueByGenre.get(row.genre) ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-tertiary">
                      {t(`genres.reasons.${reasonKey}`)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {recommended !== null && recommended !== multiplier && (
                          <form action={approveGenreAction}>
                            <input type="hidden" name="venueId" value={venue.id} />
                            <input type="hidden" name="genre" value={row.genre} />
                            <button
                              type="submit"
                              className="rounded-button bg-gold-500 px-3 py-1.5
                                font-semibold text-text-on-accent transition-transform
                                duration-100 active:scale-[0.97]"
                            >
                              {t("genres.approve")}
                            </button>
                          </form>
                        )}
                        <form action={adjustGenreAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="venueId" value={venue.id} />
                          <input type="hidden" name="genre" value={row.genre} />
                          <input
                            type="number"
                            name="multiplier"
                            min={0.8}
                            max={1.3}
                            step={0.01}
                            defaultValue={multiplier.toFixed(2)}
                            aria-label={t("genres.adjustLabel", { genre: row.genre })}
                            className={inputCls}
                          />
                          <button
                            type="submit"
                            className="rounded-button border border-line-subtle bg-surface-2
                              px-3 py-1.5 text-text-primary hover:bg-surface-3"
                          >
                            {t("genres.adjust")}
                          </button>
                        </form>
                        <form action={toggleAutoApplyAction}>
                          <input type="hidden" name="venueId" value={venue.id} />
                          <input type="hidden" name="genre" value={row.genre} />
                          <input
                            type="hidden"
                            name="enabled"
                            value={row.auto_apply ? "off" : "on"}
                          />
                          <button
                            type="submit"
                            aria-pressed={row.auto_apply}
                            className={`rounded-button border px-3 py-1.5 ${
                              row.auto_apply
                                ? "border-gold-500 text-gold-500"
                                : "border-line-subtle text-text-tertiary hover:text-text-primary"
                            }`}
                          >
                            {t("genres.autoApply")}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="pb-1 text-lg font-semibold text-text-primary">
          {t("simulator.title")}
        </h2>
        <p className="pb-4 text-sm text-text-tertiary">{t("simulator.hint")}</p>
        <Simulator
          genres={genreRows.rows.map((r) => ({
            genre: r.genre,
            multiplier: Number(r.multiplier),
          }))}
          tierLimits={tierLimits}
        />
      </section>
    </div>
  );
}
