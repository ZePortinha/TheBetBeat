"use client";

/**
 * RequestCard — the DJ cockpit card (BRIEF B7 "Cartão de pedido").
 *
 * 72px cover · title+artist at UI weight 700, 20px, truncated (full name via
 * the native `title` attribute) · BPM · key · genre · zone meta row (.tnum) ·
 * chips row (tier, fit, library) · big amount (PriceTag lg) with the
 * "Recebes X €" line · countdown ring (decision deadline in Decidir, promise
 * deadline in Alinhados) · optional guest message with a hide button ·
 * action slots passed by the parent (Aceitar/Recusar or Fixar/Marcar/Cancelar).
 *
 * The root is a motion.div with the `layout` prop: collapse-on-decision and
 * reorder animations are driven by the parent list (AnimatePresence +
 * layout). Extra motion props (exit, layoutId, …) pass straight through.
 *
 * Touch targets: the actions row stretches its children to ≥56px (B7).
 * Presentation-only: all visible strings arrive via props; `now` is injected
 * via `getNow` — never read inside domain logic.
 */

import * as React from "react";
import { useState } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { EyeOff, Library, Pin } from "lucide-react";
import type { FitLabel, Tier } from "@/lib/domain/types";
import { springMove } from "@/lib/motion";
import { Chip, FitChip } from "./fit-chip";
import { CountdownRing, formatCountdown } from "./countdown-ring";
import { PriceTag } from "./price-tag";
import { cx, Pressable } from "./pressable";

export type RequestCardMode = "decide" | "queued";

export interface RequestCardProps
  extends Omit<HTMLMotionProps<"div">, "title" | "children"> {
  /** "decide" = Decidir column; "queued" = Alinhados column. */
  mode: RequestCardMode;
  title: string;
  artist: string;
  coverUrl?: string | null;
  bpm?: number | null;
  /** Camelot notation, e.g. "8A". */
  camelotKey?: string | null;
  genre?: string | null;
  zoneName?: string | null;
  /** Tier chip text, e.g. "A Seguir". */
  tierLabel: string;
  tier?: Tier;
  fit?: FitLabel | null;
  /** Localized fit text, e.g. "Encaixa". Required to show the fit chip. */
  fitText?: string;
  inLibrary?: boolean;
  /** Library chip text, e.g. "Na biblioteca" / "Fora da biblioteca". */
  libraryText?: string;
  pinned?: boolean;
  /** Pinned chip text, e.g. "Próxima". */
  pinnedText?: string;
  amountCents: number;
  /** e.g. "Recebes 12,80 €". */
  receiveLine: string;
  /** Deadline (epoch ms): decision deadline in Decidir, promise in Alinhados. */
  deadlineAt?: number | null;
  /** Full window length in ms (for the ring fraction). */
  deadlineTotalMs?: number;
  /** Injected clock (epoch ms) for tests/stories; defaults to Date.now. */
  getNow?: () => number;
  /** Accessible label for the countdown ring, e.g. "Prazo de decisão". */
  deadlineLabel?: string;
  message?: string | null;
  /** Hide-message button label, e.g. "Ocultar". */
  hideMessageLabel?: string;
  defaultMessageHidden?: boolean;
  onHideMessage?: () => void;
  /** Action slots — parent passes Buttons (Aceitar/Recusar or Fixar/Marcar/Cancelar). */
  actions?: React.ReactNode;
  className?: string;
}

export function RequestCard({
  mode,
  title,
  artist,
  coverUrl,
  bpm,
  camelotKey,
  genre,
  zoneName,
  tierLabel,
  tier,
  fit,
  fitText,
  inLibrary,
  libraryText,
  pinned,
  pinnedText,
  amountCents,
  receiveLine,
  deadlineAt,
  deadlineTotalMs,
  getNow,
  deadlineLabel,
  message,
  hideMessageLabel,
  defaultMessageHidden = false,
  onHideMessage,
  actions,
  className,
  ...motionRest
}: RequestCardProps) {
  const [messageHidden, setMessageHidden] = useState(defaultMessageHidden);

  const metaParts: string[] = [];
  if (bpm != null) metaParts.push(`${Math.round(bpm)} BPM`);
  if (camelotKey) metaParts.push(camelotKey);
  if (genre) metaParts.push(genre);
  if (zoneName) metaParts.push(zoneName);

  return (
    <motion.div
      layout
      transition={springMove}
      data-mode={mode}
      data-tier={tier}
      className={cx(
        "rounded-card border border-line-subtle bg-surface-1 p-4",
        className,
      )}
      style={{ lineHeight: "var(--leading-dense)" }}
      {...motionRest}
    >
      <div className="flex items-start gap-3">
        {/* 72px cover */}
        <span className="relative block size-[72px] shrink-0 overflow-hidden rounded-cover">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <span
              className="flex size-full items-center justify-center text-base font-semibold text-text-secondary"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-1))",
              }}
            >
              {initials(title)}
            </span>
          )}
        </span>

        {/* Track + meta + chips */}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-xl font-bold text-text-primary"
            title={`${title} - ${artist}`}
          >
            {title}
            <span className="font-bold text-text-secondary"> · {artist}</span>
          </p>
          {metaParts.length > 0 ? (
            <p className="tnum mt-0.5 truncate text-sm text-text-tertiary">
              {metaParts.join(" · ")}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pinned && pinnedText ? (
              <Chip tone="accent" icon={<Pin size={14} strokeWidth={1.75} aria-hidden />}>
                {pinnedText}
              </Chip>
            ) : null}
            <Chip tone="accent">{tierLabel}</Chip>
            {fit && fitText ? <FitChip label={fit} text={fitText} /> : null}
            {libraryText ? (
              <Chip
                tone={inLibrary ? "neutral" : "amber"}
                icon={<Library size={14} strokeWidth={1.75} aria-hidden />}
              >
                {libraryText}
              </Chip>
            ) : null}
          </div>
        </div>

        {/* Amount + deadline ring */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end text-right">
            <PriceTag cents={amountCents} size="lg" />
            <p className="tnum mt-1 text-xs text-text-secondary">{receiveLine}</p>
          </div>
          {deadlineAt != null && deadlineTotalMs != null ? (
            <span data-ring-kind={mode === "decide" ? "decide" : "promise"}>
              <CountdownRing
                deadlineAt={deadlineAt}
                durationMs={deadlineTotalMs}
                getNow={getNow}
                size={56}
                strokeWidth={3.5}
                label={deadlineLabel}
              >
                {(remainingMs) => (
                  <span className="text-xs font-semibold text-text-primary">
                    {formatCountdown(remainingMs)}
                  </span>
                )}
              </CountdownRing>
            </span>
          ) : null}
        </div>
      </div>

      {/* Guest message (B4.7 / B7) with hide button */}
      {message && !messageHidden ? (
        <div className="mt-3 flex items-center gap-2 rounded-chip bg-surface-2 py-1 pl-3 pr-1">
          <p className="min-w-0 flex-1 truncate text-sm text-text-secondary">
            {message}
          </p>
          <Pressable
            onPress={() => {
              setMessageHidden(true);
              onHideMessage?.();
            }}
            className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-chip px-3 text-xs font-semibold text-text-tertiary"
          >
            <EyeOff size={16} strokeWidth={1.75} aria-hidden />
            {hideMessageLabel}
          </Pressable>
        </div>
      ) : null}

      {/* Action slots — stretched to the 56px minimum touch target (B7). */}
      {actions ? (
        <div className="mt-3 flex min-h-14 items-stretch gap-3">{actions}</div>
      ) : null}
    </motion.div>
  );
}

function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
