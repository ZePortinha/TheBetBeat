"use client";

/**
 * Fila — the full queue (BRIEF B7 "Outros ecrãs"): every active request
 * (Decidir + Alinhados order), filterable by tier, genre and BPM range,
 * plus a horizontal timeline of promise deadlines — simple proportional
 * bars in tabular numerals; the rings/bars are display only, deadlines
 * expire exclusively on the server.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence } from "motion/react";
import { ListMusic } from "lucide-react";
import { TIERS, type Tier } from "@/lib/domain/types";
import { TIER_PLAY_ORDER } from "@/lib/domain/ordering";
import type { StaffRequestPayload } from "@/lib/realtime/events";
import { cx, Pressable } from "@/components/ui/pressable";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CockpitRequestCard } from "./cockpit-request-card";
import { useCockpit } from "./use-cockpit";

const BPM_BUCKETS = [
  { key: "any", min: 0, max: Infinity },
  { key: "60-110", min: 60, max: 110 },
  { key: "110-125", min: 110, max: 125 },
  { key: "125-140", min: 125, max: 140 },
  { key: "140-200", min: 140, max: 200 },
] as const;

function DeadlineTimeline({
  requests,
  nowMs,
}: {
  requests: StaffRequestPayload[];
  nowMs: number;
}) {
  const t = useTranslations("cockpit.queueScreen.timeline");
  const withDeadline = requests
    .filter((r) => r.deadlineAt !== null)
    .map((r) => ({ ...r, deadlineMs: Date.parse(r.deadlineAt as string) }))
    .filter((r) => Number.isFinite(r.deadlineMs))
    .sort((a, b) => a.deadlineMs - b.deadlineMs);

  const horizonMs = Math.max(
    10 * 60_000,
    ...withDeadline.map((r) => r.deadlineMs - nowMs),
  );

  return (
    <section className="rounded-card border border-line-subtle bg-surface-1 p-4">
      <h2
        className="text-base font-bold text-text-secondary"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("title")}
      </h2>
      {withDeadline.length === 0 ? (
        <p className="mt-2 text-sm text-text-tertiary">{t("noDeadlines")}</p>
      ) : (
        <div className="tnum mt-3 flex flex-col gap-2">
          {withDeadline.map((r) => {
            const remaining = Math.max(0, r.deadlineMs - nowMs);
            const fraction = Math.min(1, remaining / horizonMs);
            const minutes = Math.ceil(remaining / 60_000);
            const tone =
              remaining < 60_000
                ? "var(--color-ember-500)"
                : remaining < 2 * 60_000
                  ? "var(--color-amber-500)"
                  : "var(--color-gold-500)";
            return (
              <div key={r.requestId} className="flex items-center gap-3 text-sm">
                <span className="w-44 truncate text-text-secondary" title={r.trackTitle}>
                  {r.trackTitle}
                </span>
                <span className="w-14 shrink-0 text-right text-text-tertiary">
                  {minutes} min
                </span>
                <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.max(2, fraction * 100)}%`,
                      background: tone,
                    }}
                  />
                </span>
              </div>
            );
          })}
          <p className="mt-1 text-right text-[length:var(--text-12)] uppercase tracking-[0.06em] text-text-tertiary">
            ← {t("nowMark")}
          </p>
        </div>
      )}
    </section>
  );
}

export function QueueScreen({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations("cockpit");
  const tCommon = useTranslations("common");
  const cockpit = useCockpit(sessionId);
  const [tierFilter, setTierFilter] = React.useState<Tier | null>(null);
  const [genreFilter, setGenreFilter] = React.useState<string>("");
  const [bpmBucket, setBpmBucket] = React.useState<(typeof BPM_BUCKETS)[number]>(
    BPM_BUCKETS[0],
  );
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  const { state, loading } = cockpit;
  if (loading && !state) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Skeleton height={48} rounded="card" />
        <Skeleton height={120} rounded="card" />
        <Skeleton height={120} rounded="card" />
      </div>
    );
  }
  if (!state?.session) {
    return (
      <EmptyState
        icon={ListMusic}
        title={t("session.none")}
        hint={t("session.noneHint")}
        className="flex-1"
      />
    );
  }

  const genres = Array.from(
    new Set(cockpit.requests.map((r) => r.trackGenre).filter((g): g is string => !!g)),
  ).sort();

  const matches = (r: StaffRequestPayload): boolean => {
    if (tierFilter && r.tier !== tierFilter) return false;
    if (genreFilter && r.trackGenre !== genreFilter) return false;
    if (bpmBucket.key !== "any") {
      if (r.trackBpm === null) return false;
      if (r.trackBpm < bpmBucket.min || r.trackBpm >= bpmBucket.max) return false;
    }
    return true;
  };

  const ordered: StaffRequestPayload[] = [
    ...cockpit.decide,
    ...(cockpit.pinned ? [cockpit.pinned] : []),
    ...TIER_PLAY_ORDER.flatMap((tier) => cockpit.queuedGroups[tier]),
  ].filter(matches);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <h1
        className="text-xl font-bold tracking-[-0.01em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("queueScreen.title")}
      </h1>

      {/* Filters: tier chips, genre chips, BPM buckets (≥56px targets). */}
      <div className="flex flex-wrap items-center gap-2">
        <Pressable
          onPress={() => setTierFilter(null)}
          className={cx(
            "min-h-12 rounded-full border px-4 text-sm font-semibold",
            tierFilter === null
              ? "border-gold-500/40 bg-gold-500/10 text-gold-500"
              : "border-line-subtle bg-surface-2 text-text-secondary",
          )}
        >
          {t("queueScreen.filters.allTiers")}
        </Pressable>
        {TIERS.map((tier) => (
          <Pressable
            key={tier}
            onPress={() => setTierFilter((prev) => (prev === tier ? null : tier))}
            className={cx(
              "min-h-12 rounded-full border px-4 text-sm font-semibold",
              tierFilter === tier
                ? "border-gold-500/40 bg-gold-500/10 text-gold-500"
                : "border-line-subtle bg-surface-2 text-text-secondary",
            )}
          >
            {tCommon(`tiers.${tier}`)}
          </Pressable>
        ))}

        <span className="mx-1 h-6 w-px bg-line-strong" aria-hidden />

        <select
          value={genreFilter}
          onChange={(event) => setGenreFilter(event.target.value)}
          className="min-h-12 rounded-full border border-line-subtle bg-surface-2 px-4 text-sm font-semibold text-text-secondary focus:border-gold-500/50 focus:outline-none"
        >
          <option value="">{t("queueScreen.filters.allGenres")}</option>
          {genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>

        <select
          value={bpmBucket.key}
          onChange={(event) => {
            const bucket = BPM_BUCKETS.find((b) => b.key === event.target.value);
            setBpmBucket(bucket ?? BPM_BUCKETS[0]);
          }}
          aria-label={t("queueScreen.filters.bpm")}
          className="tnum min-h-12 rounded-full border border-line-subtle bg-surface-2 px-4 text-sm font-semibold text-text-secondary focus:border-gold-500/50 focus:outline-none"
        >
          {BPM_BUCKETS.map((bucket) => (
            <option key={bucket.key} value={bucket.key}>
              {bucket.key === "any" ? t("queueScreen.filters.bpmAny") : `${bucket.key} BPM`}
            </option>
          ))}
        </select>
      </div>

      <DeadlineTimeline requests={cockpit.requests} nowMs={nowMs} />

      <div className="flex flex-col gap-3 pb-4">
        {ordered.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title={t("queueScreen.empty")}
            hint={t("queueScreen.emptyHint")}
          />
        ) : (
          <AnimatePresence initial={false}>
            {ordered.map((request) => (
              <CockpitRequestCard
                key={request.requestId}
                request={request}
                mode={request.status === "paid" ? "decide" : "queued"}
                config={state.session!.config}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
