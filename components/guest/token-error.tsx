import { getTranslations } from "next-intl/server";
import { QrCode } from "lucide-react";

/**
 * Friendly dead-end for invalid/forged QR tokens or venues without a live
 * session (B6 screen 1). Server component — no interactivity needed.
 */
export async function TokenError({
  kind,
}: {
  kind: "invalid_token" | "no_live_session";
}) {
  const t = await getTranslations("guest.invalid");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-card bg-surface-1 text-text-tertiary">
        <QrCode size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h1
        className="text-2xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
      >
        {t("title")}
      </h1>
      <p className="max-w-xs text-base text-text-secondary">
        {kind === "no_live_session" ? t("noSession") : t("hint")}
      </p>
    </main>
  );
}
