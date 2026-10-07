"use client";

/**
 * Party chrome: the co-branded top bar (balance pill when there is one),
 * the screen heading, and the tab bar "Agora · Leilão · Ranking" with the
 * auction as the raised gavel in the middle (2026-10-06). The party layout
 * mounts PartyChrome once, so the tab bar and the shared auction state
 * persist while switching tabs.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioLines, Gavel, Trophy, UserRound } from "lucide-react";
import { cx } from "@/components/ui/pressable";
import { AuctionOverlays, WalletPill } from "./auction-screens";
import { AuctionProvider, useAuction } from "./use-auction";

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

type Tab = "home" | "auction" | "top";

function activeTab(pathname: string): Tab {
  if (pathname.endsWith("/top")) return "top";
  // Choosing a track is part of the auction: the gavel stays lit.
  if (/\/(auction|search|track\/[^/]+|album\/[^/]+)$/.test(pathname)) return "auction";
  return "home";
}

function TabBar({ token }: { token: string }) {
  const t = useTranslations("guest.tabs");
  const pathname = usePathname();
  const { state } = useAuction();
  const base = `/s/${token}`;
  const active = activeTab(pathname);
  const live = (state?.open.length ?? 0) > 0;

  const side = (key: "home" | "top", href: string, Icon: typeof Trophy) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={cx(
        "flex flex-col items-center justify-center gap-1 transition-[color,transform] duration-100 active:scale-[0.97]",
        active === key ? "text-accent-400" : "text-text-tertiary",
      )}
    >
      <Icon size={22} strokeWidth={1.75} aria-hidden />
      <span className="text-[0.6875rem] font-medium">{t(key)}</span>
    </Link>
  );

  return (
    <nav aria-label={t("label")} data-guest-dock="" className="material fixed inset-x-0 bottom-0 z-40">
      <div className="mx-auto grid h-[4.25rem] w-full max-w-md grid-cols-3 box-content pb-[env(safe-area-inset-bottom)]">
        {side("home", base, AudioLines)}
        {/* The auction: raised, bigger, the gavel. A live dot while one is open. */}
        <Link
          href={`${base}/auction`}
          aria-current={active === "auction" ? "page" : undefined}
          className="group relative flex flex-col items-center justify-end gap-1 pb-2"
        >
          <span
            className={cx(
              "absolute -top-7 flex size-[4.25rem] items-center justify-center rounded-full bg-accent-500 text-text-on-accent ring-4 ring-bg-base transition-transform duration-100 group-active:scale-95",
              active === "auction" ? "shadow-glow-accent" : "shadow-lg",
            )}
          >
            <Gavel size={30} strokeWidth={2} aria-hidden />
            {live ? (
              <span aria-hidden className="absolute right-1.5 top-1.5 size-3 rounded-full bg-text-primary ring-2 ring-accent-500 motion-safe:animate-pulse" />
            ) : null}
          </span>
          <span className={cx("text-xs font-bold", active === "auction" ? "text-accent-400" : "text-text-primary")}>
            {t("auction")}
          </span>
        </Link>
        {side("top", `${base}/top`, Trophy)}
      </div>
    </nav>
  );
}

export function PartyChrome({
  token,
  venueName,
  sessionId,
  children,
}: PartyValue & { sessionId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Task screens (one request, the account) keep their own back header.
  const showTabs = !/\/requests\/[^/]+$|\/account$/.test(pathname);

  return (
    <PartyContext.Provider value={{ token, venueName }}>
      <AuctionProvider token={token} sessionId={sessionId}>
        {children}
        <AuctionOverlays />
        {showTabs ? <TabBar token={token} /> : null}
      </AuctionProvider>
    </PartyContext.Provider>
  );
}

/** "BETBEAT × VENUE" on the left (home); balance (if any) + account on the right. */
export function PartyTopBar() {
  const { token, venueName } = useParty();
  const tc = useTranslations("common");
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
        <WalletPill token={token} />
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
      <h1 className="mt-1 break-words text-3xl font-bold text-text-primary">
        {title}
      </h1>
      {sub ? <p className="mt-1.5 text-base text-text-secondary">{sub}</p> : null}
    </div>
  );
}

/** Live dot for eyebrows ("● Ao vivo"). */
export function LiveDot() {
  return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
}
