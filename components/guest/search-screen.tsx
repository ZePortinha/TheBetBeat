"use client";

/**
 * Search screen (B6 screen 2): autofocus, instant visual feedback, 200 ms
 * debounce that only prevents duplicate fetches (never delays feedback),
 * curated sections when the query is empty, grayed unavailable rows with
 * the reason.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchX } from "lucide-react";
import { TrackRow } from "@/components/ui/track-row";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { BackHeader } from "./back-header";
import type { SearchResponseDto, SearchTrackDto } from "./types";

const DEBOUNCE_MS = 200;

const SECTION_LABEL_KEY = {
  results: "sectionResults",
  fits: "sectionFits",
  popular: "sectionPopular",
  recent: "sectionRecent",
} as const;

export function SearchScreen({ token }: { token: string }) {
  const t = useTranslations("guest.search");
  const tFit = useTranslations("common.fit");
  const router = useRouter();
  const { ready } = useGuest();

  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<SearchResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = React.useRef(0);

  const runSearch = React.useCallback(
    async (q: string) => {
      const seq = ++requestSeq.current;
      const qs = new URLSearchParams({ token });
      if (q) qs.set("q", q);
      const res = await apiFetch<SearchResponseDto>(`/api/guest/search?${qs}`);
      if (seq !== requestSeq.current) return; // a newer query superseded us
      if (res.ok) setData(res.data);
      setLoading(false);
    },
    [token],
  );

  // Initial sections once the anonymous session exists.
  React.useEffect(() => {
    if (!ready) return;
    void runSearch("");
  }, [ready, runSearch]);

  function onChange(value: string) {
    setQuery(value); // instant visual feedback — debounce only the fetch
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void runSearch(value.trim()), DEBOUNCE_MS);
  }

  const sections = data?.sections ?? [];
  const noResults =
    !loading && query.trim().length > 0 && sections.every((s) => s.tracks.length === 0);

  return (
    <main className="flex min-h-dvh flex-col gap-4 px-4 pb-10 pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}`} />

      <input
        // 16px font minimum: prevents iOS zoom-on-focus (B10.3).
        autoFocus
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("placeholder")}
        aria-label={t("placeholder")}
        className="w-full rounded-button border border-line-subtle bg-surface-3 px-4 py-3 text-base text-text-primary placeholder:text-text-tertiary focus:border-gold-500 focus:outline-none"
      />

      {loading ? (
        <div className="flex flex-col gap-2 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={64} rounded="card" />
          ))}
        </div>
      ) : noResults ? (
        <EmptyState icon={SearchX} title={t("empty")} hint={t("emptyHint")} />
      ) : (
        sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-2">
            <p className="label text-text-tertiary">
              {t(SECTION_LABEL_KEY[section.key])}
            </p>
            {section.tracks.map((track) => (
              <SearchRow
                key={`${section.key}:${track.id}`}
                track={track}
                fitText={tFit(track.fitLabel)}
                fromText={t("from", { price: formatEurosDisplay(track.fromPriceCents) })}
                unavailableText={
                  track.reason ? t(`unavailable.${track.reason}`) : undefined
                }
                onSelect={() => router.push(`/s/${token}/track/${track.id}`)}
              />
            ))}
          </section>
        ))
      )}
    </main>
  );
}

function SearchRow({
  track,
  fitText,
  fromText,
  unavailableText,
  onSelect,
}: {
  track: SearchTrackDto;
  fitText: string;
  fromText: string;
  unavailableText?: string;
  onSelect: () => void;
}) {
  return (
    <TrackRow
      title={track.title}
      artist={track.artist}
      fit={track.fitLabel}
      fitText={fitText}
      available={track.available}
      {...(unavailableText ? { unavailableReason: unavailableText } : {})}
      priceSlot={
        <span className="tnum text-sm font-semibold text-gold-500">{fromText}</span>
      }
      {...(track.available ? { onSelect } : {})}
    />
  );
}
