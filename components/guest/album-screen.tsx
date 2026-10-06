"use client";

/**
 * Album (full catalog): every song of the album in order, each with its
 * BPM and transition chip; a song opens the bid screen. BPMs still being
 * measured fill in on the next visit.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Disc3 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { SearchRow } from "./search-screen";
import type { AlbumDto, SearchTrackDto } from "./types";

export function AlbumScreen({ token, albumId }: { token: string; albumId: string }) {
  const t = useTranslations("guest.search");
  const router = useRouter();
  const { ready } = useGuest();
  const [data, setData] = React.useState<{ album: AlbumDto; tracks: SearchTrackDto[] } | null | "missing">(null);

  React.useEffect(() => {
    if (!ready) return;
    const qs = new URLSearchParams({ token, albumId });
    void apiFetch<{ album: AlbumDto; tracks: SearchTrackDto[] }>(`/api/guest/catalog/album?${qs}`).then((res) =>
      setData(res.ok ? res.data : "missing"),
    );
  }, [ready, token, albumId]);

  if (data === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton height={112} rounded="card" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={64} rounded="card" />
        ))}
      </div>
    );
  }
  if (data === "missing") return <EmptyState icon={Disc3} title={t("albumMissing")} hint={t("albumMissingHint")} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {data.album.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from the provider's CDN
          <img src={data.album.coverUrl} alt="" className="size-28 shrink-0 rounded-card object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="label truncate text-accent-400">{data.album.artist}</p>
          <h2 className="text-2xl font-bold leading-tight text-text-primary">{data.album.title}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("albumTracks", { count: data.tracks.length })}</p>
        </div>
      </div>
      <ol className="flex flex-col gap-1">
        {data.tracks.map((track) => (
          <li key={track.id}>
            <SearchRow
              track={track}
              fitText={t(`transition.${track.transition}`, { bpm: track.bpm === null ? "" : Math.round(track.bpm) })}
              fromText={t("bid")}
              {...(track.reason ? { unavailableText: t(`unavailable.${track.reason}`) } : {})}
              onSelect={() => router.push(`/s/${token}/track/${track.id}`)}
            />
          </li>
        ))}
      </ol>
      <p className="text-center text-xs text-text-tertiary">{t("catalogCredit")}</p>
    </div>
  );
}
