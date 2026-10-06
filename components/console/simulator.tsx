"use client";

/**
 * Pricing simulator (B5.9): sliders for B, R, active requests, SOON
 * occupancy, genre and fit S → live SVG polyline chart of the three
 * tier prices (last 60 computed points as the sliders sweep) + the
 * breakdown table (base, M_g, F, D, occupancy).
 *
 * computeQuoteFromFit is imported DIRECTLY from lib/pricing — it is a
 * pure function (no I/O), so it runs client-side with a synthetic
 * QuoteInput. Slider thumbs respond instantly; only the recompute is
 * debounced (100 ms), per B10.6-2 (debounce never delays feedback).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  computeQuoteFromFit,
  type QuoteInput,
  type QuoteResult,
} from "@/lib/pricing";
import type { Tier } from "@/lib/domain/types";

export interface SimulatorProps {
  genres: Array<{ genre: string; multiplier: number }>;
  tierLimits: Record<Tier, { minCents: number; maxCents: number }>;
}

interface Controls {
  baseEur: number;
  rate: number;
  queueActive: number;
  soonActive: number;
  genre: string;
  fit: number;
}

interface HistoryPoint {
  QUEUE: number | null;
  SOON: number | null;
  NEXT: number | null;
}

const SERIES: Array<{ tier: Tier; color: string }> = [
  { tier: "QUEUE", color: "var(--color-accent-500)" },
  { tier: "SOON", color: "var(--color-amber-500)" },
  { tier: "NEXT", color: "var(--color-ember-500)" },
];

const MAX_POINTS = 60;

function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("pt-PT", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`;
}

function buildInput(c: Controls, props: SimulatorProps, now: number): QuoteInput {
  const active: QuoteInput["queue"]["active"] = [];
  for (let i = 0; i < c.queueActive; i += 1) {
    active.push({
      tier: "QUEUE",
      amountCents: 1200,
      paidAtMs: now - (i + 1) * 60_000,
      trackDurationSec: 200,
    });
  }
  for (let i = 0; i < c.soonActive; i += 1) {
    active.push({
      tier: "SOON",
      amountCents: 2500,
      paidAtMs: now - (i + 1) * 45_000,
      trackDurationSec: 200,
    });
  }
  return {
    session: {
      basePriceCents: Math.round(c.baseEur * 100),
      acceptanceRatePerHour: c.rate,
      endsAtMs: now + 4 * 60 * 60 * 1000,
      tierLimits: props.tierLimits,
      genres: [c.genre],
      soonDeadlineMin: 20,
      lastPublished: null, // no smoothing: the simulator shows raw response
      minFitScore: 0,
    },
    queue: { active, currentTrackRemainingSec: 150 },
    track: { genre: c.genre, bpm: null, camelotKey: null },
    set: { recentBpms: [], recentGenres: [], currentKey: null },
    venue: {
      genreMultipliers: Object.fromEntries(
        props.genres.map((g) => [g.genre, g.multiplier]),
      ),
    },
  };
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="label text-text-secondary">{label}</span>
        <span className="text-sm font-semibold text-text-primary tnum">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent-500)]"
      />
    </label>
  );
}

export function Simulator({ genres, tierLimits }: SimulatorProps) {
  const t = useTranslations("console.pricing.simulator");
  const [controls, setControls] = useState<Controls>({
    baseEur: 10,
    rate: 8,
    queueActive: 3,
    soonActive: 1,
    genre: genres[0]?.genre ?? "house",
    fit: 0.9,
  });
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const props = useMemo(() => ({ genres, tierLimits }), [genres, tierLimits]);

  // Debounced recompute: 100 ms after the last control change (B5.9).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const quote = computeQuoteFromFit(
        buildInput(controls, props, Date.now()),
        Date.now(),
        controls.fit,
      );
      setResult(quote);
      setHistory((prev) => {
        const point: HistoryPoint = { QUEUE: null, SOON: null, NEXT: null };
        for (const tierQuote of quote.tiers) {
          point[tierQuote.tier] = tierQuote.available ? tierQuote.priceCents : null;
        }
        return [...prev, point].slice(-MAX_POINTS);
      });
    }, 100);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [controls, props]);

  const set = <K extends keyof Controls>(key: K, value: Controls[K]) =>
    setControls((prev) => ({ ...prev, [key]: value }));

  // Chart geometry.
  const maxPrice = Math.max(
    1000,
    ...history.flatMap((p) => SERIES.map((s) => p[s.tier] ?? 0)),
  );
  const W = 600;
  const H = 180;
  const x = (i: number) =>
    history.length <= 1 ? W : (i / (Math.max(history.length, MAX_POINTS) - 1)) * W;
  const y = (cents: number) => H - 8 - (cents / maxPrice) * (H - 24);

  const pathFor = (tier: Tier): string => {
    let d = "";
    let pen = false;
    history.forEach((point, i) => {
      const value = point[tier];
      if (value === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="flex flex-col gap-5 rounded-card border border-line-subtle bg-surface-1 p-5">
        <Slider
          label={t("basePrice")}
          value={controls.baseEur}
          display={`${controls.baseEur} €`}
          min={5}
          max={60}
          step={1}
          onChange={(v) => set("baseEur", v)}
        />
        <Slider
          label={t("rate")}
          value={controls.rate}
          display={`${controls.rate}/h`}
          min={1}
          max={20}
          step={1}
          onChange={(v) => set("rate", v)}
        />
        <Slider
          label={t("activeRequests")}
          value={controls.queueActive}
          display={String(controls.queueActive)}
          min={0}
          max={30}
          step={1}
          onChange={(v) => set("queueActive", v)}
        />
        <Slider
          label={t("soonActive")}
          value={controls.soonActive}
          display={String(controls.soonActive)}
          min={0}
          max={8}
          step={1}
          onChange={(v) => set("soonActive", v)}
        />
        <Slider
          label={t("fit")}
          value={controls.fit}
          display={controls.fit.toFixed(2)}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set("fit", v)}
        />
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("genre")}</span>
          <select
            value={controls.genre}
            onChange={(e) => set("genre", e.target.value)}
            className="rounded-button border border-line-subtle bg-surface-3 px-3 py-2
              text-sm text-text-primary focus:border-accent-500 focus:outline-none"
          >
            {genres.map((g) => (
              <option key={g.genre} value={g.genre}>
                {g.genre} · ×{g.multiplier.toFixed(2)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
          <div className="flex items-center gap-5 pb-3">
            {SERIES.map(({ tier, color }) => {
              const quote = result?.tiers.find((q) => q.tier === tier);
              return (
                <span key={tier} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="text-text-secondary">{t(`tiers.${tier}`)}</span>
                  <span className="font-semibold text-text-primary tnum">
                    {quote?.available
                      ? euros(quote.priceCents)
                      : t("unavailable")}
                  </span>
                </span>
              );
            })}
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={t("chartLabel")}
            className="h-48 w-full"
            preserveAspectRatio="none"
          >
            <line
              x1="0"
              y1={H - 8}
              x2={W}
              y2={H - 8}
              stroke="var(--color-line-strong)"
              strokeWidth="1"
            />
            {SERIES.map(({ tier, color }) => (
              <path
                key={tier}
                d={pathFor(tier)}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          <p className="pt-1 text-xs text-text-tertiary">{t("chartHint")}</p>
        </div>

        {result && (
          <div className="rounded-card border border-line-subtle bg-surface-1 p-5">
            <h3 className="pb-3 text-sm font-semibold text-text-primary">
              {t("breakdown")}
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    [t("factors.base"), euros(result.breakdown.base)],
                    [t("factors.genre"), `×${result.breakdown.genreMultiplier.toFixed(2)}`],
                    [t("factors.fit"), `×${result.breakdown.fitFactor.toFixed(3)}`],
                    [t("factors.demand"), `×${result.breakdown.demandFactor.toFixed(3)}`],
                    [t("factors.occupancy"), result.breakdown.occupancy.toFixed(2)],
                    [t("factors.rho"), result.demand.rho.toFixed(2)],
                  ] as const
                ).map(([label, value]) => (
                  <tr key={label} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-text-secondary">{label}</td>
                    <td className="py-2 text-right font-semibold text-text-primary tnum">
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
