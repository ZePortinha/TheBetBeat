"use client";

/**
 * Sessão & Receita (BRIEF B7): revenue/hour as a plain-div bar chart,
 * acceptance %, refunds by reason, top tracks, payout status, CSV export
 * (client-generated from the stats API) and PDF via print stylesheet +
 * window.print(). All figures are this session's own (B12.2).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PriceTag } from "@/components/ui/price-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEurosDisplay, formatLisbonTime } from "./format";
import type { CockpitStats } from "./types";

const PRINT_CSS = `
@media print {
  body { background: #fff !important; }
  [data-stats-screen] { color: #111 !important; }
  [data-stats-screen] .print-card { border-color: #ddd !important; background: #fff !important; }
  .print\\:hidden { display: none !important; }
}
`;

function buildCsv(stats: CockpitStats): string {
  const lines: string[] = [];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  lines.push("section,key,value_cents,count");
  lines.push(`statement,gmv,${stats.statement.gmv},`);
  lines.push(`statement,refunds,${stats.statement.refunds},`);
  lines.push(`statement,dj_net,${stats.statement.djNet},`);
  lines.push(
    `acceptance,rate,${stats.acceptance.rate ?? ""},${stats.acceptance.decided}`,
  );
  for (const h of stats.revenuePerHour) {
    lines.push(`revenue_per_hour,${esc(h.hour)},${h.totalCents},${h.count}`);
  }
  for (const r of stats.refundsByReason) {
    lines.push(`refunds_by_reason,${esc(r.reason)},${r.totalCents},${r.count}`);
  }
  for (const t of stats.topTracks) {
    lines.push(
      `top_tracks,${esc(`${t.title} — ${t.artist}`)},${t.totalCents},${t.count}`,
    );
  }
  for (const p of stats.payouts) {
    lines.push(`payouts,${esc(`${p.recipient}:${p.status}`)},${p.amountCents},`);
  }
  return lines.join("\n");
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="print-card rounded-card border border-line-subtle bg-surface-1 p-4">
      <h2
        className="text-base font-bold text-text-secondary"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StatsScreen({ sessionId, footer }: { sessionId: string | null; footer?: React.ReactNode }) {
  const t = useTranslations("cockpit.stats");
  const tSession = useTranslations("cockpit.session");
  const [stats, setStats] = React.useState<CockpitStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetch(`/api/cockpit/stats?sessionId=${encodeURIComponent(sessionId)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`stats ${res.status}`);
          const data = (await res.json()) as CockpitStats;
          if (!cancelled) {
            setStats(data);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <EmptyState
        icon={BarChart3}
        title={tSession("none")}
        hint={tSession("noneHint")}
        className="flex-1"
      />
    );
  }
  if (loading || !stats) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Skeleton height={48} rounded="card" />
        <Skeleton height={160} rounded="card" />
        <Skeleton height={120} rounded="card" />
      </div>
    );
  }

  const maxHour = Math.max(1, ...stats.revenuePerHour.map((h) => h.totalCents));
  const acceptancePct =
    stats.acceptance.rate === null ? null : Math.round(stats.acceptance.rate * 100);

  const exportCsv = () => {
    const blob = new Blob([buildCsv(stats)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betbeat-sessao-${sessionId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-stats-screen
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <style>{PRINT_CSS}</style>
      <div className="flex items-center justify-between gap-3">
        <h1
          className="text-xl font-bold tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h1>
        <div className="flex gap-3 print:hidden">
          <Button size="lg" variant="secondary" onPress={exportCsv}>
            {t("exportCsv")}
          </Button>
          <Button size="lg" variant="secondary" onPress={() => window.print()}>
            {t("exportPdf")}
          </Button>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-3 gap-4">
        {(
          [
            ["gmv", stats.statement.gmv],
            ["refundsTotal", stats.statement.refunds],
            ["djNet", stats.statement.djNet],
          ] as const
        ).map(([key, cents]) => (
          <div
            key={key}
            className="print-card rounded-card border border-line-subtle bg-surface-1 p-4"
          >
            <p className="label text-text-tertiary">{t(key)}</p>
            <PriceTag cents={cents} size="lg" className="mt-2" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title={t("revenuePerHour")}>
          {stats.revenuePerHour.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t("noTracks")}</p>
          ) : (
            <div className="flex h-40 items-end gap-2">
              {stats.revenuePerHour.map((h) => (
                <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="tnum text-[length:var(--text-12)] text-text-secondary">
                    {formatEurosDisplay(h.totalCents)}
                  </span>
                  <div
                    className="w-full rounded-t-[4px]"
                    style={{
                      height: `${Math.max(4, (h.totalCents / maxHour) * 120)}px`,
                      background: "var(--gradient-heat)",
                    }}
                    role="img"
                    aria-label={`${formatLisbonTime(Date.parse(h.hour))} — ${formatEurosDisplay(h.totalCents)}`}
                  />
                  <span className="tnum text-[length:var(--text-12)] text-text-tertiary">
                    {formatLisbonTime(Date.parse(h.hour))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("acceptance")}>
          <p className="tnum text-[length:var(--text-40)] font-bold text-accent-400">
            {acceptancePct === null ? "—" : `${acceptancePct}%`}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {t("acceptanceDetail", {
              accepted: stats.acceptance.accepted,
              decided: stats.acceptance.decided,
            })}
          </p>
        </Card>

        <Card title={t("refundsByReason")}>
          {stats.refundsByReason.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t("noRefunds")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.refundsByReason.map((r) => (
                <li key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {t.has(`closeReasons.${r.reason}` as never) ? t(`closeReasons.${r.reason}` as never) : r.reason}
                    <span className="tnum ml-2 text-text-tertiary">×{r.count}</span>
                  </span>
                  <span className="tnum font-semibold text-text-primary">
                    {formatEurosDisplay(r.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("topTracks")}>
          {stats.topTracks.length === 0 ? (
            <p className="text-sm text-text-tertiary">{t("noTracks")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {stats.topTracks.map((track, index) => (
                <li
                  key={`${track.title}-${track.artist}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="tnum w-5 text-text-tertiary">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-text-primary">
                    {track.title}
                    <span className="font-normal text-text-secondary"> · {track.artist}</span>
                  </span>
                  <span className="tnum text-text-tertiary">
                    {t("requestsLabel", { count: track.count })}
                  </span>
                  <span className="tnum font-semibold text-accent-400">
                    {formatEurosDisplay(track.totalCents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title={t("payout")}>
        {stats.payouts.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("payoutNone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stats.payouts.map((p) => (
              <li key={p.recipient} className="flex items-center justify-between text-sm">
                <span className="uppercase tracking-[0.04em] text-text-secondary">
                  {p.recipient}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tnum font-semibold text-text-primary">
                    {formatEurosDisplay(p.amountCents)}
                  </span>
                  <span
                    className={
                      p.status === "paid"
                        ? "text-green-500"
                        : p.status === "failed"
                          ? "text-ember-500"
                          : "text-amber-500"
                    }
                  >
                    {t(`payoutStatus.${p.status}` as never)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {footer}
    </div>
  );
}
