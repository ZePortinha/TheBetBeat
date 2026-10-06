"use client";

/**
 * The guest's front door: point the camera at the event's QR. Native
 * BarcodeDetector where the browser has it (Android Chrome), jsQR on
 * canvas frames everywhere else (iPhone Safari). Only a BetBeat guest path
 * (/s/<token>) is ever followed, and always on this site: a QR pointing
 * elsewhere is refused, never opened.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { guestPathFrom } from "@/lib/guest-path";

type Phase = "idle" | "starting" | "scanning" | "denied" | "unsupported";

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

  const stop = React.useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const start = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      return;
    }
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
      {/* Viewfinder: four corners and a sweeping line (motion-safe). */}
      <div aria-hidden className="pointer-events-none absolute inset-[14%]">
        {["left-0 top-0 border-l-4 border-t-4 rounded-tl-card", "right-0 top-0 border-r-4 border-t-4 rounded-tr-card", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-card", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-card"].map((c) => (
          <span key={c} className={`absolute size-10 border-accent-500 ${c}`} />
        ))}
        {phase === "scanning" ? <span className="scan-line absolute inset-x-2 top-0 h-0.5 rounded-full bg-accent-400 shadow-[0_0_14px_var(--color-accent-400)]" /> : null}
      </div>

      {phase !== "scanning" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
          {phase === "denied" || phase === "unsupported" ? (
            <>
              <CameraOff size={36} className="text-text-tertiary" aria-hidden />
              <p className="text-base text-text-secondary">{phase === "denied" ? t("denied") : t("unsupported")}</p>
              {phase === "denied" ? (
                <Button variant="secondary" onPress={() => void start()}>
                  {t("retry")}
                </Button>
              ) : null}
            </>
          ) : (
            <Button size="lg" loading={phase === "starting"} onPress={() => void start()}>
              <Camera size={20} aria-hidden />
              {t("scan")}
            </Button>
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
