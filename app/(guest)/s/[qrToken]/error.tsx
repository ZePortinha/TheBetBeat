"use client";

/**
 * Guest route error boundary (B10.8 "cada erro diz o que aconteceu e o
 * que fazer a seguir"; B12.4 no stack traces). The digest is the only
 * detail shown — a support reference, never the message.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GuestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("guest.errors");
  const tc = useTranslations("common.actions");

  useEffect(() => {
    console.error("[guest] route error", error.digest ?? "");
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-card bg-surface-1 text-text-tertiary">
        <CloudOff size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h1
        className="text-2xl font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
      >
        {t("pageTitle")}
      </h1>
      <p className="max-w-xs text-base text-text-secondary">{t("pageHint")}</p>
      {error.digest ? (
        <p className="tnum text-xs text-text-tertiary">{t("withCode", { code: error.digest })}</p>
      ) : null}
      <Button variant="secondary" onPress={reset}>
        {tc("retry")}
      </Button>
    </main>
  );
}
