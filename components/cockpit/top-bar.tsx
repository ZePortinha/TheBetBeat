"use client";

/**
 * Ao Vivo top bar (BRIEF B7): 64px translucent material — session name,
 * the BIG open/pause requests switch, queue search, session revenue with
 * "Recebes X €", connection state, clock and end time.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Wifi, WifiOff } from "lucide-react";
import { springDefault } from "@/lib/motion";
import type { RealtimeConnectionState } from "@/lib/realtime/client";
import { cx, Pressable } from "@/components/ui/pressable";
import { PriceTag } from "@/components/ui/price-tag";
import { formatEurosDisplay, formatLisbonTime } from "./format";

/** Large open/pause switch — the top bar's main control (B7). */
function RequestsSwitch({
  open,
  onToggle,
  label,
  openText,
  pausedText,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  label: string;
  openText: string;
  pausedText: string;
}) {
  return (
    <Pressable
      role="switch"
      aria-checked={open}
      aria-label={label}
      onPress={() => onToggle(!open)}
      className={cx(
        "flex min-h-14 items-center gap-2 rounded-full border px-2 py-1",
        open
          ? "border-green-500/40 bg-green-500/10"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <span
        className={cx(
          "relative block h-8 w-14 rounded-full transition-colors duration-100",
          open ? "bg-green-500" : "bg-surface-3",
        )}
        aria-hidden
      >
        {/* iOS switch: the track carries the state, the knob stays white. */}
        <motion.span
          className="absolute top-1 block size-6 rounded-full bg-text-primary shadow-md"
          animate={{ x: open ? 26 : 4 }}
          transition={springDefault}
        />
      </span>
      <span
        className={cx(
          "pr-2 text-sm font-bold",
          open ? "text-green-500" : "text-amber-500",
        )}
      >
        {open ? openText : pausedText}
      </span>
    </Pressable>
  );
}

function Clock({ endsAt }: { endsAt: string }) {
  const t = useTranslations("cockpit");
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex flex-col items-end" aria-label={t("a11y.clock")}>
      <span className="tnum text-xl font-bold leading-none text-text-primary">
        {formatLisbonTime(nowMs)}
      </span>
      <span className="tnum mt-0.5 text-sm text-text-tertiary">
        {t("topBar.endsAt", { time: formatLisbonTime(Date.parse(endsAt)) })}
      </span>
    </div>
  );
}

export interface TopBarProps {
  sessionName: string;
  requestsOpen: boolean;
  onToggleOpen: (open: boolean) => void;
  revenueCents: number;
  djCents: number;
  connection: RealtimeConnectionState;
  online: boolean;
  endsAt: string;
}

export function TopBar({
  sessionName,
  requestsOpen,
  onToggleOpen,
  revenueCents,
  djCents,
  connection,
  online,
  endsAt,
}: TopBarProps) {
  const t = useTranslations("cockpit");

  const connectionState: RealtimeConnectionState = !online ? "offline" : connection;
  const connectionTone =
    connectionState === "connected"
      ? "text-green-500"
      : connectionState === "offline"
        ? "text-ember-500"
        : "text-amber-500";

  return (
    <header className="material z-40 flex h-16 shrink-0 items-center gap-4 border-b border-line-strong px-4">
      <h1 className="min-w-0 shrink truncate text-xl font-bold tracking-[-0.01em]">
        {sessionName}
      </h1>

      <RequestsSwitch
        open={requestsOpen}
        onToggle={onToggleOpen}
        label={t("a11y.pauseSwitch")}
        openText={t("topBar.requestsOpen")}
        pausedText={t("topBar.requestsPaused")}
      />

      <div className="flex-1" />

      <div className="flex shrink-0 flex-col items-end">
        <PriceTag cents={revenueCents} size="md" />
        <span className="tnum text-sm text-text-secondary">
          {t("topBar.youReceive", { amount: formatEurosDisplay(djCents) })}
        </span>
      </div>

      <div
        className={cx("flex shrink-0 items-center gap-1.5 text-sm font-semibold", connectionTone)}
        role="status"
      >
        {connectionState === "offline" ? (
          <WifiOff size={20} strokeWidth={1.75} aria-hidden />
        ) : (
          <Wifi size={20} strokeWidth={1.75} aria-hidden />
        )}
        <span className="hidden lg:inline">
          {t(`topBar.connection.${connectionState}`)}
        </span>
      </div>

      <Clock endsAt={endsAt} />
    </header>
  );
}
