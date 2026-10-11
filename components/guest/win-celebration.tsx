"use client";

/**
 * "Vencedor" — the moment a guest's bid wins (2026-10-08 redesign): a flat,
 * sharp 2D stage (win-scene: mirror ball, coloured stage lights, champagne,
 * confetti) on a canvas behind the album art, the title and the amount.
 * No 3D and no extra download, so it opens at once and stays smooth on any
 * phone. "Partilhar no Instagram" shares the same animation as a video
 * (win-video), recorded quietly in the background while the guest watches.
 * Reduced motion: one still frame of the same stage.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { Crown, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { toast } from "@/components/ui/toast";
import { Disc } from "@/components/ui/disc";
import { startWinScene } from "./win-scene";
import { recordWinVideo, videoType } from "./win-video";

function useCountUp(target: number, ms: number, run: boolean): number {
  const [value, setValue] = React.useState(run ? 0 : target);
  React.useEffect(() => {
    if (!run) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, run]);
  return value;
}

/** Into the phone's share sheet (Instagram lives there); no share sheet: download. */
async function shareFile(file: File, title: string): Promise<"shared" | "saved"> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title });
    return "shared";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}

/** The still story card (1080×1920), when this browser cannot record video. */
async function storyImage(slotId: string): Promise<File> {
  const res = await fetch(`/api/guest/auction/${slotId}/card?format=story`);
  if (!res.ok) throw new Error("card");
  return new File([await res.blob()], "betbeat-vencedor.png", { type: "image/png" });
}

/** "sáb · 21 set · 01:24" in Lisbon. */
function footerDate(locale: string, at: Date): string {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "Europe/Lisbon" }).format(at).replace(/\.$/, "");
  return `${part({ weekday: "short" })} · ${part({ day: "numeric" })} ${part({ month: "short" })} · ${part({ hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

type VideoState = "recording" | "ready" | "none";


/** Loads the album cover through our proxy so the canvas stays same-origin. */
function useCoverBitmap(slotId: string, coverUrl?: string | null): ImageBitmap | null {
  const [bmp, setBmp] = React.useState<ImageBitmap | null>(null);
  React.useEffect(() => {
    if (!coverUrl) return;
    let cancelled = false;
    fetch(`/api/guest/auction/${slotId}/cover`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => createImageBitmap(b))
      .then((img) => { if (!cancelled) setBmp(img); })
      .catch(() => {});
    return () => { cancelled = true; bmp?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, coverUrl]);
  return bmp;
}

export function WinCelebration({
  slotId,
  trackTitle,
  trackArtist,
  totalCents,
  coverUrl,
  venueName,
  onClose,
}: {
  slotId: string;
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  coverUrl?: string | null;
  venueName: string;
  onClose: () => void;
}) {
  const t = useTranslations("guest.auction");
  const tc = useTranslations("common");
  const locale = useLocale();
  const reduced = useReducedMotion() ?? false;
  const stage = React.useRef<HTMLCanvasElement>(null);
  const amount = useCountUp(totalCents, 900, !reduced);
  const title = t("winTitle");
  const coverBmp = useCoverBitmap(slotId, coverUrl);

  // The stage starts on the first frame: no import, no 3D to warm up.
  React.useEffect(() => {
    if (!stage.current) return;
    return startWinScene(stage.current, { cover: coverBmp, still: reduced });
  }, [reduced, coverBmp]);

  // The Instagram video records in the background, once the opening burst
  // has played on screen (so the two never compete for the same frames).
  const video = React.useRef<File | null>(null);
  const [videoState, setVideoState] = React.useState<VideoState>(() => "recording");
  const [wantShare, setWantShare] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  React.useEffect(() => {
    if (!videoType()) {
      setVideoState("none");
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      recordWinVideo(
        slotId,
        {
          brand: `${tc("appName")} × ${venueName}`,
          eyebrow: t("winEyebrow"),
          title,
          amount: formatEurosDisplay(totalCents),
          trackTitle,
          trackArtist,
          footer: footerDate(locale, new Date()),
        },
        abort.signal,
      )
        .then((file) => {
          video.current = file;
          setVideoState("ready");
        })
        .catch(() => {
          if (!abort.signal.aborted) setVideoState("none");
        });
    }, 1600);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [slotId, venueName, trackTitle, trackArtist, totalCents, title, locale, t, tc]);

  const share = React.useCallback(async () => {
    setSharing(true);
    try {
      const file = video.current ?? (await storyImage(slotId));
      if ((await shareFile(file, t("shareTitle"))) === "saved") {
        toast({ title: video.current ? t("shareVideoSaved") : t("shareSaved") });
      }
    } catch (error) {
      const name = (error as Error).name;
      // Closing the share sheet is not an error; a lost tap (the video took
      // a moment) just needs one more tap on the now-ready button.
      if (name !== "AbortError" && name !== "NotAllowedError") toast({ title: t("shareError"), variant: "error" });
    } finally {
      setSharing(false);
    }
  }, [slotId, t]);

  // Tapped while the video was still recording: share as soon as it lands.
  React.useEffect(() => {
    if (!wantShare || videoState === "recording") return;
    setWantShare(false);
    void share();
  }, [wantShare, videoState, share]);

  const preparing = wantShare && videoState === "recording";

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 overflow-hidden bg-bg-base text-center">
      <canvas ref={stage} aria-hidden className="absolute inset-0 size-full" />

      <div className="relative flex h-full flex-col items-center gap-5 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-[19dvh] [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">
        {/* The album art: pops in with the flash, sharp edges, a red glow. */}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <motion.div
            className="aspect-square h-full max-h-[min(62vw,34dvh)] overflow-hidden rounded-card shadow-glow-accent ring-2 ring-white/85"
            initial={reduced ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.55, delay: 0.05 }}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from the provider's CDN
              <img src={coverUrl.replace(/\/\d+x\d+-/, "/500x500-")} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center bg-surface-1">
                <Disc seed={trackTitle} className="size-4/5" />
              </div>
            )}
          </motion.div>
        </div>

        <div className="flex flex-col items-center">
          <p className="label flex items-center gap-1.5 text-amber-500">
            <Crown size={16} aria-hidden />
            {t("winEyebrow")}
          </p>
          <h1 className="mt-1 flex text-5xl font-bold tracking-tight text-text-primary" aria-label={title}>
            {[...title].map((ch, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="inline-block"
                initial={reduced ? false : { y: 22, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", bounce: 0, duration: 0.4, delay: 0.15 + i * 0.035 }}
              >
                {ch === " " ? " " : ch}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="tnum mt-2 text-4xl font-bold text-accent-400"
            initial={reduced ? false : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.45, delay: 0.35 }}
          >
            {formatEurosDisplay(amount)}
          </motion.p>
          <motion.div
            initial={reduced ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.55 }}
          >
            <p className="mt-2 line-clamp-1 text-xl font-semibold text-text-primary">{trackTitle}</p>
            <p className="line-clamp-1 text-base text-text-secondary">{trackArtist}</p>
            <p className="mt-2 text-sm text-text-secondary">{t("winHint")}</p>
          </motion.div>
        </div>

        <motion.div
          className="flex w-full max-w-xs flex-col gap-2"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.7 }}
        >
          <Button
            size="lg"
            fullWidth
            loading={sharing}
            aria-busy={preparing || undefined}
            onPress={() => {
              if (videoState === "recording") setWantShare(true);
              else void share();
            }}
          >
            <Instagram size={20} aria-hidden />
            {preparing ? t("sharePreparing") : t("shareInstagram")}
          </Button>
          <Button size="lg" variant="secondary" fullWidth onPress={onClose}>
            {t("winClose")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
