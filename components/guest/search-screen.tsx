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
import { ChevronRight, Search, SearchX } from "lucide-react";
import { Pressable } from "@/components/ui/pressable";
import { TrackRow } from "@/components/ui/track-row";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { AuctionContextBar } from "./auction-screens";
import { PartyHeading, PartyTopBar } from "./party-chrome";
import type { SearchResponseDto, SearchTrackDto } from "./types";

const DEBOUNCE_MS = 200;

export const TRANSITION_CHIP = { easy: "fits", medium: "possible", hard: "off_style", unknown: null } as const;

const SECTION_LABEL_KEY = {
  results: "sectionResults",
  catalog: "sectionCatalog",
  trending: "sectionTrending",
  fits: "sectionFits",
  popular: "sectionPopular",
  recent: "sectionRecent",
} as const;

export function SearchScreen({ token }: { token: string }) {
  const t = useTranslations("guest.search");
  const router = useRouter();
  const { ready } = useGuest();

  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<SearchResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [loadingMore, setLoadingMore] = React.useState(false);

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
      setPage(0);
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

  /** "Mostrar mais": the next page of the full catalog, appended. */
  async function loadMore() {
    const q = query.trim();
    if (!q || loadingMore) return;
    setLoadingMore(true);
    const seq = requestSeq.current;
    const qs = new URLSearchParams({ token, q, page: String(page + 1) });
    const res = await apiFetch<SearchResponseDto>(`/api/guest/search?${qs}`);
    setLoadingMore(false);
    if (!res.ok || seq !== requestSeq.current) return;
    const more = res.data.sections.find((s) => s.key === "catalog")?.tracks ?? [];
    setPage((p) => p + 1);
    setData((prev) => {
      if (!prev) return prev;
      const seen = new Set(prev.sections.flatMap((s) => s.tracks.map((tr) => tr.id)));
      const fresh = more.filter((tr) => !seen.has(tr.id));
      const hasCatalog = prev.sections.some((s) => s.key === "catalog");
      return {
        hasMore: res.data.hasMore ?? false,
        sections: hasCatalog
          ? prev.sections.map((s) => (s.key === "catalog" ? { ...s, tracks: [...s.tracks, ...fresh] } : s))
          : [...prev.sections, { key: "catalog", tracks: fresh }],
      };
    });
  }

  const sections = data?.sections ?? [];
  const noResults =
    !loading && query.trim().length > 0 && sections.every((s) => s.tracks.length === 0);

  return (
    <main className="flex min-h-dvh flex-col gap-4 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-4">
      <PartyTopBar />
      {/* Which auction this track is for: tap to go back and pick another. */}
      <AuctionContextBar token={token} />
      <PartyHeading title={t("title")} />

      <label className="relative block">
        <Search
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
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
          className="min-h-14 w-full rounded-card border border-line-strong bg-surface-2 py-3 pl-12 pr-4 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none"
        />
      </label>

      {loading ? (
        <div className="flex flex-col gap-2 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={64} rounded="card" />
          ))}
        </div>
      ) : noResults ? (
        <EmptyState icon={SearchX} title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <>
          {data?.albums && data.albums.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="label text-text-tertiary">{t("sectionAlbums")}</p>
              {data.albums.map((album) => (
                <Pressable
                  key={album.providerAlbumId}
                  onPress={() => router.push(`/s/${token}/album/${album.providerAlbumId}`)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-cover px-4 py-2 text-left data-pressed:bg-surface-2"
                >
                  {album.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from the provider's CDN
                    <img src={album.coverUrl} alt="" loading="lazy" decoding="async" className="size-12 shrink-0 rounded-chip object-cover" />
                  ) : (
                    <span aria-hidden className="size-12 shrink-0 rounded-chip bg-surface-3" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-text-primary">{album.title}</span>
                    <span className="block truncate text-sm text-text-secondary">
                      {album.artist}
                      {album.trackCount ? ` · ${t("albumTracks", { count: album.trackCount })}` : ""}
                    </span>
                  </span>
                  <ChevronRight size={20} strokeWidth={1.75} className="shrink-0 text-text-tertiary" aria-hidden />
                </Pressable>
              ))}
            </section>
          ) : null}
          {sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-2">
            <p className="label text-text-tertiary">
              {t(SECTION_LABEL_KEY[section.key])}
            </p>
            {section.tracks.map((track) => (
              <SearchRow
                key={`${section.key}:${track.id}`}
                track={track}
                fitText={t(`transition.${track.transition}`, { bpm: track.bpm === null ? "" : Math.round(track.bpm) })}
                fromText={t("bid")}
                unavailableText={
                  track.reason ? t(`unavailable.${track.reason}`) : undefined
                }
                onSelect={() => router.push(`/s/${token}/track/${track.id}`)}
              />
            ))}
          </section>
          ))}
        </>
      )}
      {data?.hasMore && query.trim() ? (
        <Button variant="secondary" fullWidth loading={loadingMore} onPress={() => void loadMore()}>
          {t("showMore")}
        </Button>
      ) : null}
      {sections.some((s) => s.key === "catalog" || s.key === "trending") ? (
        <p className="pt-2 text-center text-xs text-text-tertiary">{t("catalogCredit")}</p>
      ) : null}
    </main>
  );
}

export function SearchRow({
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
      coverUrl={track.coverUrl}
      // The chip is the transition assistant: green easy, amber medium, red hard.
      fit={TRANSITION_CHIP[track.transition]}
      fitText={fitText}
      available={track.available}
      {...(unavailableText ? { unavailableReason: unavailableText } : {})}
      priceSlot={
        <span className="tnum text-sm font-semibold text-accent-400">{fromText}</span>
      }
      {...(track.available ? { onSelect } : {})}
    />
  );
}
