import "server-only";

import { ImageResponse } from "next/og";
import { ShareCard, SHARE_CARD_SIZES, type ShareCardFormat } from "@/components/ui/share-card";

/**
 * Rasterizes the shareable ShareCard (Satori-safe markup, literal colours)
 * for the guest's moments: "A minha música tocou" and "Vencedor do leilão".
 */
export function shareCardResponse(card: {
  format: ShareCardFormat;
  headline: string;
  trackTitle: string;
  trackArtist: string;
  coverUrl: string | null;
  venueName: string;
  at: Date;
  locale: "pt-PT" | "en";
}): ImageResponse {
  const fmt = new Intl.DateTimeFormat(card.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Lisbon",
  });
  // e.g. "sáb., 21 de set., 01:24" → normalize to "sáb · 21 set · 01:24"
  const dateTimeLabel = fmt
    .format(card.at)
    .replace(/[.,]/g, "")
    .replace(/\sde\s/g, " ")
    .split(/\s+/)
    .join(" ")
    .replace(/^(\S+)\s(.+)\s(\d{2}:\d{2})$/, "$1 · $2 · $3");

  const { width, height } = SHARE_CARD_SIZES[card.format];
  return new ImageResponse(
    (
      <ShareCard
        format={card.format}
        headline={card.headline}
        trackTitle={card.trackTitle}
        trackArtist={card.trackArtist}
        coverUrl={card.coverUrl}
        venueName={card.venueName}
        dateTimeLabel={dateTimeLabel}
      />
    ),
    { width, height },
  );
}
