"use client";

/**
 * Root error boundary for the pages outside the guest party (front door,
 * venues page, login). Never a stack trace: the digest is the support
 * reference (B12.4).
 */

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errors");
  const tc = useTranslations("common");

  useEffect(() => {
    console.error("[app] route error", error.digest ?? "");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-card bg-surface-1 text-text-tertiary">
        <CloudOff size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h1 className="text-2xl font-bold tracking-[var(--tracking-heading)] text-text-primary">
        {t("pageTitle")}
      </h1>
      <p className="max-w-xs text-base text-text-secondary">{t("pageHint")}</p>
      {error.digest ? (
        <p className="tnum text-xs text-text-tertiary">{t("withCode", { code: error.digest })}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onPress={reset}>
          {tc("actions.retry")}
        </Button>
        <Link href="/" className="inline-flex min-h-11 items-center px-3 font-semibold text-accent-400">
          {tc("notFound.cta")}
        </Link>
      </div>
    </main>
  );
}
