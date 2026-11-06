"use client";

/**
 * The guest's front door: point the camera at the event's QR. Native
 * BarcodeDetector where the browser has it (Android Chrome), jsQR on
 * canvas frames everywhere else (iPhone Safari). Only a Discontrol guest path
 * (/s/<token>) is ever followed, and always on this site: a QR pointing
 * elsewhere is refused, never opened.
 * No live camera (plain-http address, or camera refused): the button takes
 * a photo with the phone's own camera instead and reads the QR from it.
 * That button is a native <label> around the file input, so the tap itself
 * opens the picker (iOS ignores input.click() outside a user gesture), and
 * the live-camera button confirms on release, which iOS counts as one.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guestPathFrom } from "@/lib/guest-path";

type Phase = "idle" | "starting" | "scanning" | "denied";

const noSubscribe = () => () => undefined;
/** Live camera API present (missing on plain http and in old browsers). */
const hasLiveCamera = () => Boolean(navigator.mediaDevices?.getUserMedia);

// The file input sits inside the label (visually hidden, still focusable),
// so a keyboard focus ring is drawn on the label around it.
const photoCapsule =
  "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-full " +
  "touch-manipulation bg-accent-500 font-semibold text-text-on-accent transition-[transform,background-color] " +
  "duration-100 active:scale-[0.97] active:bg-accent-700 " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-500";

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

export function QrScanner() {
  const t = useTranslations("guest.entry");
  const router = useRouter();
  const video = React.useRef<HTMLVideoElement>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [notOurs, setNotOurs] = React.useState(false);
  const [noCode, setNoCode] = React.useState(false);
  // Server render assumes a live camera; the client corrects it on hydration.
  const liveCamera = React.useSyncExternalStore(noSubscribe, hasLiveCamera, () => true);

  const stop = React.useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const start = React.useCallback(async () => {
    if (!hasLiveCamera()) return;
    setPhase("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setPhase("scanning");
    } catch {
      setPhase("denied");
    }
  }, []);

  // Camera already allowed (a returning guest): open it straight away.
  React.useEffect(() => {
    void navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((status) => {
        if (status.state === "granted") void start();
      })
      .catch(() => undefined);
    return stop;
  }, [start, stop]);

  // Decode loop while the camera runs.
  React.useEffect(() => {
    if (phase !== "scanning") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = Native ? new Native({ formats: ["qr_code"] }) : null;
    let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    if (!detector) void import("jsqr").then((m) => (jsQR = m.default));

    const found = (text: string) => {
      const path = guestPathFrom(text);
      if (!path) {
        setNotOurs(true);
        return false;
      }
      navigator.vibrate?.(30);
      stop();
      router.push(path);
      return true;
    };

    const scan = async () => {
      const el = video.current;
      if (cancelled || !el || el.readyState < 2) {
        timer = setTimeout(scan, 200);
        return;
      }
      try {
        if (detector) {
          const codes = await detector.detect(el);
          if (codes[0] && found(codes[0].rawValue)) return;
        } else if (jsQR && ctx) {
          const w = 480;
          const h = Math.round((el.videoHeight / el.videoWidth) * w) || w;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(el, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
          if (code && found(code.data)) return;
        }
      } catch {
        // A frame that cannot be read: try the next one.
      }
      if (!cancelled) timer = setTimeout(scan, 220);
    };
    void scan();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, router, stop]);

  /** A photo of the QR (no live camera): read it once. */
  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setNoCode(false);
    setNotOurs(false);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx?.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const jsQR = (await import("jsqr")).default;
      const code = ctx ? jsQR(ctx.getImageData(0, 0, w, h).data, w, h) : null;
      if (!code) return setNoCode(true);
      const path = guestPathFrom(code.data);
      if (!path) return setNotOurs(true);
      navigator.vibrate?.(30);
      router.push(path);
    } catch {
      setNoCode(true);
    }
  };

  /** The photo button: a label around the file input, so the tap opens it. */
  const photoButton = (text: string, size: string) => (
    <label className={`${photoCapsule} ${size}`}>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          void readPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Camera size={20} aria-hidden />
      {text}
    </label>
  );

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-sheet bg-surface-1 ring-1 ring-line-strong">
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        aria-hidden
        className={phase === "scanning" ? "absolute inset-0 size-full object-cover" : "hidden"}
      />
      {/* Viewfinder: four white corners like the iOS code scanner, and a
          sweeping line (motion-safe); the red stays on the button. */}
      <div aria-hidden className="pointer-events-none absolute inset-[14%]">
        {["left-0 top-0 border-l-4 border-t-4 rounded-tl-card", "right-0 top-0 border-r-4 border-t-4 rounded-tr-card", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-card", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-card"].map((c) => (
          <span key={c} className={`absolute size-10 border-text-primary/85 ${c}`} />
        ))}
        {phase === "scanning" ? <span className="scan-line absolute inset-x-2 top-0 h-0.5 rounded-full bg-text-primary/70" /> : null}
      </div>

      {phase !== "scanning" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
          {phase === "denied" ? (
            <>
              <CameraOff size={36} className="text-text-tertiary" aria-hidden />
              <p className="text-base text-text-secondary">
                {notOurs ? t("notOurs") : noCode ? t("photoNoCode") : t("denied")}
              </p>
              {photoButton(t("photo"), "min-h-11 px-5 text-base")}
              <Button variant="secondary" activateOn="release" onPress={() => void start()}>
                {t("retry")}
              </Button>
            </>
          ) : liveCamera ? (
            <Button size="lg" activateOn="release" loading={phase === "starting"} onPress={() => void start()}>
              <Camera size={20} aria-hidden />
              {t("scan")}
            </Button>
          ) : (
            <>
              {/* No live camera here: the same button takes a photo of the QR. */}
              {photoButton(t("scan"), "min-h-14 px-6 text-xl")}
              {notOurs || noCode ? (
                <p role="status" className="text-base text-text-secondary">
                  {notOurs ? t("notOurs") : t("photoNoCode")}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {notOurs && phase === "scanning" ? (
        <p role="status" className="absolute inset-x-4 bottom-4 rounded-card bg-bg-base/80 px-3 py-2 text-center text-sm text-text-primary backdrop-blur">
          {t("notOurs")}
        </p>
      ) : null}
    </div>
  );
}
