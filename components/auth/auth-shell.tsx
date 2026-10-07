/**
 * AuthShell — centred sign-in frame for login and MFA (Apple ID style):
 * a slim nav with the lockup, then one column with the brand mark, the
 * title and the form.
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BrandLockup, BrandMark } from "@/components/ui/brand-mark";

export async function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const tc = await getTranslations("common");

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="ambient absolute inset-0 -z-10" />
      <header className="mx-auto flex h-13 w-full max-w-[1024px] items-center px-5 md:px-8">
        <Link href="/" aria-label={tc("appName")} className="flex min-h-11 items-center">
          <BrandLockup name={tc("appName")} />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-8">
        <div className="w-full max-w-sm">
          <BrandMark className="mx-auto size-16" />
          <h1 className="mt-6 text-center font-display text-[2rem] font-semibold leading-[1.1] tracking-[var(--tracking-display)] text-text-primary">
            {title}
          </h1>
          {subtitle ? (
            <p className="mb-8 mt-3 text-center text-base leading-relaxed text-text-secondary">
              {subtitle}
            </p>
          ) : (
            <div className="mb-6" />
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
