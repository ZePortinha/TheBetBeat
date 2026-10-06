"use client";

/**
 * QRBlock (BRIEF B10.5 / B8) — a QR code on a white card.
 * Scanners need a light background: white rounded-card surface, dark
 * modules, and ALWAYS a quiet zone (margin ≥ 4 modules, baked into the
 * generated image). The QR NEVER animates (B13: "O QR nunca anima") —
 * no motion components, no transitions, static placeholder while encoding.
 */

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";

/** Quiet zone in modules — never below the spec minimum of 4. */
export const QR_QUIET_ZONE_MODULES = 4;

export interface QRBlockProps {
  /** The URL to encode (e.g. the session join link). */
  url: string;
  /** Rendered QR square size in px (card padding comes on top). */
  size?: number;
  /** Optional caption slot below the card. */
  caption?: ReactNode;
  /** Accessible description of the QR target. */
  alt?: string;
  className?: string;
}

export function QRBlock({
  url,
  size = 200,
  caption,
  alt = "QR code",
  className,
}: QRBlockProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: QR_QUIET_ZONE_MODULES,
      // 2x for crisp rendering on retina displays; CSS scales it down.
      width: size * 2,
      color: { dark: "#0b0b0c", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <figure
      className={["inline-flex flex-col items-center gap-3", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="rounded-card bg-white p-3">
        {src && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL; next/image adds nothing here.
          <img
            src={src}
            alt={alt}
            width={size}
            height={size}
            className="block"
            draggable={false}
          />
        ) : failed ? (
          // Encoding failed: show the raw link so the guest can still type it.
          <div
            className="grid place-items-center break-all p-2 text-center text-[length:var(--text-12)] text-bg-base"
            style={{ width: size, height: size }}
          >
            {url}
          </div>
        ) : (
          // Static placeholder (NO shimmer, NO animation) keeping layout.
          <div style={{ width: size, height: size }} aria-hidden="true" />
        )}
      </div>
      {caption ? (
        <figcaption className="max-w-[32ch] text-center text-[length:var(--text-14)] text-text-secondary">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
