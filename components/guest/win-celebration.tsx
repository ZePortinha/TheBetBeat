"use client";

/**
 * "Vencedor" — the moment a guest's bid wins ("Gold & Smoke", 2026-10-10):
 * a 2D stage (win-scene: champagne bottle, flying cork, the album art pressed
 * into a spinning glass vinyl) on a canvas behind the title and the amount.
 * No 3D and no extra download, so it opens at once and stays smooth on any
 * phone. It lives on its own page (2026-11-06): the whole screen, nothing
 * scrolls, no tab bar; two buttons, "Partilhar no Instagram" and "Voltar".
 * The share is a Story picture in the style of Spotify's song cards
 * (win-story: the art's colour, a still of this animation, the song and
 * the mark), drawn quietly while the guest watches so the share sheet
 * opens from the tap itself. Reduced motion: one still frame of the stage.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Crown, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { toast } from "@/components/ui/toast";
import { startWinScene } from "./win-scene";
import { buildWinStory } from "./win-story";

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

/** The server's plain story card (1080×1920), when the phone cannot draw ours. */
async function storyImage(slotId: string): Promise<File> {
  const res = await fetch(`/api/guest/auction/${slotId}/card?format=story`);
  if (!res.ok) throw new Error("card");
  return new File([await res.blob()], "discontrol-vencedor.png", { type: "image/png" });
}

type StoryState = "preparing" | "ready" | "failed";

/**
 * Nothing behind the winner's screen may scroll: a scroll lets iOS resize
 * its toolbar, and the page showed through at the top and the bottom.
 */
function useNoScroll() {
  React.useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const before = { html: html.style.overflow, body: body.style.overflow, overscroll: html.style.overscrollBehavior };
    window.scrollTo(0, 0);
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = before.html;
      body.style.overflow = before.body;
      html.style.overscrollBehavior = before.overscroll;
    };
  }, []);
}


/**
 * Loads the album cover through our proxy so the canvas stays same-origin.
 * `settled` turns true when the attempt ends, with or without an image, so
 * the record never waits for art that will not come.
 */
function useCoverBitmap(slotId: string, coverUrl?: string | null): { bmp: ImageBitmap | null; settled: boolean } {
  const [state, setState] = React.useState<{ bmp: ImageBitmap | null; settled: boolean }>({ bmp: null, settled: !coverUrl });
  React.useEffect(() => {
    if (!coverUrl) return;
    let cancelled = false;
    let loaded: ImageBitmap | null = null;
    fetch(`/api/guest/auction/${slotId}/cover`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => createImageBitmap(b))
      .then((img) => {
        loaded = img;
        if (!cancelled) setState({ bmp: img, settled: true });
        else img.close();
      })
      .catch(() => {
        if (!cancelled) setState({ bmp: null, settled: true });
      });
    return () => {
      cancelled = true;
      loaded?.close();
    };
  }, [slotId, coverUrl]);
  return state;
}

export function WinCelebration({
  slotId,
  trackTitle,
  trackArtist,
  totalCents,
  coverUrl,
  venueName,
  onBack,
}: {
  slotId: string;
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  coverUrl?: string | null;
  venueName: string;
  /** "Voltar": to the ranking, at the guest's own place. */
  onBack: () => void;
}) {
  const t = useTranslations("guest.auction");
  const tc = useTranslations("common");
  const reduced = useReducedMotion() ?? false;
  useNoScroll();
  const stage = React.useRef<HTMLCanvasElement>(null);
  const amount = useCountUp(totalCents, 900, !reduced);
  const title = t("winTitle");
  const { bmp: coverBmp, settled: coverSettled } = useCoverBitmap(slotId, coverUrl);
  const coverRef = React.useRef<ImageBitmap | null>(null);
  coverRef.current = coverBmp;

  // The stage starts on the first frame; the cover is pressed into the
  // spinning vinyl the moment it arrives, without restarting the scene.
  // Reduced motion draws one still frame, so it redraws with the cover.
  const stillCover = reduced ? coverBmp : null;
  // With album art on the way, the record waits dark and starts turning only
  // when the art is pressed in. Read every frame, so the scene never restarts.
  const coverPending = React.useRef(false);
  coverPending.current = !coverSettled;
  React.useEffect(() => {
    if (!stage.current) return;
    return startWinScene(stage.current, { coverRef, coverPending, still: reduced });
  }, [reduced, stillCover]);

  // The Story picture is drawn once the album art has settled and the
  // opening burst has played (so the two never compete for the same frames).
  const story = React.useRef<File | null>(null);
  const [storyState, setStoryState] = React.useState<StoryState>("preparing");
  const [wantShare, setWantShare] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const eyebrow = t("shareTitle");
  const brand = tc("appName");
  React.useEffect(() => {
    if (!coverSettled) return;
    let alive = true;
    const timer = setTimeout(() => {
      buildWinStory(coverBmp, { eyebrow, trackTitle, trackArtist, brand, venueName })
        // The phone could not draw it: the server's plain card instead.
        .catch(() => storyImage(slotId))
        .then((file) => {
          if (!alive) return;
          story.current = file;
          setStoryState("ready");
        })
        .catch(() => {
          if (alive) setStoryState("failed");
        });
    }, 1400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [coverSettled, coverBmp, eyebrow, trackTitle, trackArtist, brand, venueName, slotId]);

  const share = React.useCallback(async () => {
    const file = story.current;
    if (!file) {
      toast({ title: t("shareError"), variant: "error" });
      return;
    }
    setSharing(true);
    try {
      // Straight from the tap, nothing awaited first: iOS refuses a share
      // sheet that opens after a wait.
      if ((await shareFile(file, t("shareTitle"))) === "saved") toast({ title: t("shareSaved") });
    } catch (error) {
      const name = (error as Error).name;
      // Closing the share sheet is not an error; a lost tap (the picture
      // took a moment) just needs one more tap on the now-ready button.
      if (name !== "AbortError" && name !== "NotAllowedError") toast({ title: t("shareError"), variant: "error" });
    } finally {
      setSharing(false);
    }
  }, [t]);

  // Tapped while the picture was still being drawn: share as soon as it lands.
  React.useEffect(() => {
    if (!wantShare || storyState === "preparing") return;
    setWantShare(false);
    if (storyState === "ready") void share();
    else toast({ title: t("shareError"), variant: "error" });
  }, [wantShare, storyState, share, t]);

  const preparing = wantShare && storyState === "preparing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // touch-none: a drag on the screen never reaches the page behind it.
      className="cover-chrome fixed inset-0 z-50 touch-none overflow-hidden overscroll-none bg-bg-base text-center"
    >
      <canvas ref={stage} aria-hidden className="absolute inset-0 size-full" />

      <div className="relative flex h-full flex-col items-center gap-5 px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-[19dvh] [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">
        {/* The spinning vinyl (drawn on the stage) lives in this space. */}
        <div className="min-h-0 w-full flex-1" />

        <div className="flex flex-col items-center">
          <p className="label flex items-center gap-1.5 text-amber-500">
            <Crown size={16} aria-hidden />
            {t("winEyebrow")}
          </p>
          <h1 className="mt-1 flex text-5xl font-bold tracking-[var(--tracking-display)] text-text-primary" aria-label={title}>
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
          className="flex w-full max-w-[17.5rem] flex-col gap-2"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.7 }}
        >
          <Button
            fullWidth
            loading={sharing}
            aria-busy={preparing || undefined}
            // The share sheet only opens from a finished tap on phones.
            activateOn="release"
            onPress={() => {
              if (storyState === "preparing") setWantShare(true);
              else void share();
            }}
          >
            <Instagram size={18} aria-hidden />
            {preparing ? t("sharePreparing") : t("shareInstagram")}
          </Button>
          <Button variant="secondary" fullWidth onPress={onBack}>
            <ChevronLeft size={18} aria-hidden />
            {t("winBack")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
