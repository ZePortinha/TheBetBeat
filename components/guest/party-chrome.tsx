"use client";

/**
 * Party chrome: the co-branded top bar (balance pill when there is one),
 * the screen heading, and the tab bar "Agora · Leilão · Ranking" with the
 * auction as the raised gavel in the middle (2026-10-06). The party layout
 * mounts PartyChrome once, so the tab bar and the shared auction state
 * persist while switching tabs. The winner's screen has no tab bar at all,
 * and the bar steps aside while the keyboard is up.
 */

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioLines, Gavel, Trophy, UserRound } from "lucide-react";
import { cx } from "@/components/ui/pressable";
import { AuctionOverlays, WalletPill } from "./auction-screens";
import { winSlotFrom } from "./party-paths";
import { PhoneGate } from "./phone-gate";
import { AuctionProvider, useAuction } from "./use-auction";
import { Wordmark } from "@/components/ui/brand-mark";

// The winner's screen loads on demand; leading an auction loads it early
// (AuctionOverlays), so a win never waits for it.
const WinScreen = dynamic(() => import("./win-screen").then((m) => m.WinScreen), {
  ssr: false,
  loading: () => <div aria-hidden className="cover-chrome fixed inset-0 z-50 bg-bg-base" />,
});

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

/** Fields that bring up the on-screen keyboard. */
function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image"].includes(el.type);
}

/**
 * True while the guest types. iOS Safari leaves fixed bars where the
 * keyboard pushed them until the next scroll, so the bar leaves while the
 * keyboard is up and comes back laid out afresh (it would only sit on top
 * of the keyboard anyway).
 */
function useTyping(): boolean {
  const [typing, setTyping] = React.useState(false);
  React.useEffect(() => {
    const update = () => setTyping(isTextField(document.activeElement));
    // focusout fires before focus lands on the next field: read it a tick later.
    const later = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return typing;
}

function TabBar({ token }: { token: string }) {
  const t = useTranslations("guest.tabs");
  const pathname = usePathname();
  const { state } = useAuction();
  const base = `/s/${token}`;
  const active = activeTab(pathname);
  const live = (state?.open.length ?? 0) > 0;
  const typing = useTyping();

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

  if (typing) return null;
  return (
    <nav aria-label={t("label")} data-guest-dock="" className="material dock-extend fixed inset-x-0 z-40">
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
              "absolute -top-7 flex size-[4.25rem] items-center justify-center rounded-full bg-accent-500 text-text-on-accent ring-4 ring-bg-base transition-transform duration-100 group-active:scale-[0.97]",
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
  phoneRequired,
  children,
}: PartyValue & { sessionId: string; phoneRequired: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  // The winner's moment fills the screen on its own: no bar, no overlays.
  // It is drawn here, in the layout, the moment the win lands (`pending`),
  // and stays the same element once the address reaches /win/<slot>, so
  // it never waits for a page load and never restarts.
  const routeWin = winSlotFrom(pathname);
  const [pendingWin, setPendingWin] = React.useState<string | null>(null);
  const wasOnWin = React.useRef(false);
  React.useEffect(() => {
    // Left the winner's page (Voltar, or the phone's Back): the moment is over.
    if (wasOnWin.current && !routeWin) setPendingWin(null);
    wasOnWin.current = routeWin !== null;
  }, [routeWin]);
  const winSlot = routeWin ?? pendingWin;
  const leaveWin = React.useCallback(() => setPendingWin(null), []);
  // Task screens (one request, the account) keep their own back header.
  const showTabs = !winSlot && !/\/requests\/[^/]+$|\/account$/.test(pathname);
  // The front door: number + SMS code (and a new number's @) before the party.
  const [entered, setEntered] = React.useState(!phoneRequired);
  const enter = React.useCallback(() => setEntered(true), []);

  if (!entered) return <PhoneGate venueName={venueName} onEntered={enter} />;

  return (
    <PartyContext.Provider value={{ token, venueName }}>
      <AuctionProvider token={token} sessionId={sessionId}>
        {children}
        <AuctionOverlays token={token} quiet={winSlot !== null} onWin={setPendingWin} />
        {showTabs ? <TabBar token={token} /> : null}
        {winSlot ? (
          <WinScreen key={winSlot} token={token} slotId={winSlot} venueName={venueName} onLeave={leaveWin} />
        ) : null}
      </AuctionProvider>
    </PartyContext.Provider>
  );
}

/** "DISCONTROL × VENUE" on the left (home); balance (if any) + account on the right. */
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
        <Wordmark name={tc("appName")} />
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
