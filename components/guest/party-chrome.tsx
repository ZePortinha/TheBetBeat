"use client";

/**
 * Party chrome (2026-10-05, layout from the "Pedir faixa / Fila ao vivo /
 * Rankings" mockup, in the Apple palette and type): the co-branded top
 * bar, the screen heading, the CTA that floats above the tab bar, and the
 * tab bar itself. The party layout mounts PartyChrome once, so the tab bar
 * persists while switching tabs.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioLines, ListMusic, Trophy, UserRound } from "lucide-react";

interface PartyValue {
  token: string;
  venueName: string;
}

const PartyContext = React.createContext<PartyValue | null>(null);

export function useParty(): PartyValue {
  const value = React.useContext(PartyContext);
  if (!value) throw new Error("useParty outside PartyChrome");
  return value;
}

type Tab = "request" | "queue" | "top";

function activeTab(pathname: string): Tab {
  if (pathname.endsWith("/queue")) return "queue";
  if (pathname.endsWith("/top")) return "top";
  return "request";
}

export function PartyChrome({
  token,
  venueName,
  children,
}: PartyValue & { children: React.ReactNode }) {
  const t = useTranslations("guest.tabs");
  const pathname = usePathname();
  const base = `/s/${token}`;
  // Task screens (one request, the account) keep their own back header.
  const showTabs = !/\/requests\/[^/]+$|\/account$/.test(pathname);
  const active = activeTab(pathname);

  const tabs: Array<{ key: Tab; href: string; Icon: typeof ListMusic }> = [
    { key: "request", href: `${base}/search`, Icon: ListMusic },
    { key: "queue", href: `${base}/queue`, Icon: AudioLines },
    { key: "top", href: `${base}/top`, Icon: Trophy },
  ];

  return (
    <PartyContext.Provider value={{ token, venueName }}>
      {children}
      {showTabs ? (
        <nav aria-label={t("label")} className="material fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto grid h-[4.25rem] w-full max-w-md grid-cols-3 box-content pb-[env(safe-area-inset-bottom)]">
            {tabs.map(({ key, href, Icon }) => (
              <Link
                key={key}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 transition-[color,transform] duration-100 active:scale-[0.97] ${
                  active === key ? "text-accent-400" : "text-text-tertiary"
                }`}
              >
                <Icon size={22} strokeWidth={1.75} aria-hidden />
                <span className="text-[0.6875rem] font-medium">
                  {t(key)}
                </span>
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </PartyContext.Provider>
  );
}

/** "BETBEAT × VENUE" on the left (home), trophy + account on the right. */
export function PartyTopBar() {
  const { token, venueName } = useParty();
  const tc = useTranslations("common");
  const tTabs = useTranslations("guest.tabs");
  const tAccount = useTranslations("guest.account");

  return (
    <header className="flex items-center justify-between gap-3">
      <Link
        href={`/s/${token}`}
        className="flex min-h-11 min-w-0 items-center gap-1.5 text-sm font-semibold"
      >
        <span className="text-accent-400">{tc("appName")}</span>
        <span aria-hidden className="text-text-tertiary">
          ×
        </span>
        <span className="truncate text-text-primary">{venueName}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/s/${token}/top`}
          aria-label={tTabs("top")}
          className="flex size-11 items-center justify-center text-accent-400 transition-transform duration-100 active:scale-[0.97]"
        >
          <Trophy size={20} strokeWidth={1.75} aria-hidden />
        </Link>
        <Link
          href={`/s/${token}/account`}
          aria-label={tAccount("accountButton")}
          className="flex size-11 items-center justify-center transition-transform duration-100 active:scale-[0.97]"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-accent-300 ring-1 ring-accent-500/40">
            <UserRound size={18} strokeWidth={1.75} aria-hidden />
          </span>
        </Link>
      </div>
    </header>
  );
}

/** Gold eyebrow, heavy display title, optional line under it. */
export function PartyHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      {eyebrow ? <p className="label flex items-center gap-1.5 text-accent-400">{eyebrow}</p> : null}
      <h1 className="mt-1.5 break-words text-[clamp(2rem,9vw,2.6rem)] font-bold leading-[1.05] tracking-[var(--tracking-display)] text-text-primary">
        {title}
      </h1>
      {sub ? <p className="mt-2 text-base leading-relaxed text-text-secondary">{sub}</p> : null}
    </div>
  );
}

/** The screen's main action, floating just above the tab bar. */
export function DockCta({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-h)] z-30 bg-linear-to-t from-bg-base via-bg-base/90 to-transparent pt-8">
      <div className="pointer-events-auto mx-auto w-full max-w-md px-4 pb-3">{children}</div>
    </div>
  );
}

/** Live dot for eyebrows ("● Ao vivo"). */
export function LiveDot() {
  return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
}
