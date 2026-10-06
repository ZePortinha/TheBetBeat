"use client";

/**
 * "QR do evento": the code guests scan to open THIS event (a signed
 * "session" token), ready to print, post or send. Generated on demand;
 * the download is a 1200 px PNG with the quiet zone baked in.
 */

import * as React from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { Download, QrCode, Share2 } from "lucide-react";
import { QRBlock, QR_QUIET_ZONE_MODULES } from "@/components/ui/qr-block";
import { CopyButton } from "./copy-button";

export function EventQr({ url, fileName }: { url: string; fileName: string }) {
  const t = useTranslations("console.sessions.qr");
  const [shown, setShown] = React.useState(false);

  async function download() {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 1200,
      margin: QR_QUIET_ZONE_MODULES,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${fileName}.png`;
    a.click();
  }

  async function share() {
    try {
      await navigator.share({ title: t("title"), url });
    } catch {
      // Closed the sheet, or no share sheet here: the copy button is right there.
    }
  }

  return (
    <section
      data-testid="event-qr"
      className="mb-8 flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">{t("hint")}</p>
      </div>
      {shown ? (
        <div className="flex flex-wrap items-start gap-6">
          <QRBlock url={url} size={220} alt={t("alt")} />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void download()}
              className="flex min-h-11 items-center gap-2 rounded-button bg-accent-500 px-4 text-sm font-semibold text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
            >
              <Download size={16} aria-hidden />
              {t("download")}
            </button>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <button
                type="button"
                onClick={() => void share()}
                className="flex min-h-11 items-center gap-2 rounded-button bg-surface-3 px-4 text-sm font-semibold text-text-primary transition-transform duration-100 active:scale-[0.97]"
              >
                <Share2 size={16} aria-hidden />
                {t("share")}
              </button>
            ) : null}
            <CopyButton value={url} label={t("copy")} copiedLabel={t("copied")} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="event-qr-generate"
          onClick={() => setShown(true)}
          className="flex min-h-11 items-center gap-2 self-start rounded-button bg-accent-500 px-5 text-base font-semibold text-text-on-accent transition-transform duration-100 active:scale-[0.97]"
        >
          <QrCode size={18} aria-hidden />
          {t("generate")}
        </button>
      )}
    </section>
  );
}
