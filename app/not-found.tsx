import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Disc3 } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.meta");
  return { title: t("notFoundTitle"), robots: { index: false, follow: false } };
}

/** Any unknown URL: say so plainly and hand the guest back to the front door. */
export default async function NotFound() {
  const t = await getTranslations("common.notFound");
  return (
    <div className="relative isolate">
      <div aria-hidden className="ambient pointer-events-none fixed inset-0 -z-10" />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-card bg-surface-1 text-accent-400">
          <Disc3 size={28} strokeWidth={1.75} aria-hidden />
        </div>
        <h1 className="text-2xl font-bold tracking-[var(--tracking-heading)] text-text-primary">
          {t("title")}
        </h1>
        <p className="max-w-xs text-base text-text-secondary">{t("hint")}</p>
        <Link
          href="/"
          className="mt-2 inline-flex min-h-12 items-center rounded-full bg-accent-500 px-6 text-base font-semibold text-text-on-accent transition-[background-color,transform] duration-100 hover:bg-accent-400 active:scale-[0.97] active:bg-accent-700"
        >
          {t("cta")}
        </Link>
      </main>
    </div>
  );
}
