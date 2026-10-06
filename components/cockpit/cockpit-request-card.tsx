"use client";

/**
 * Binds a StaffRequestPayload to the shared RequestCard (B7 "Cartão de
 * pedido"): localized chips, "Recebes X €", the right countdown ring
 * (decision window in Decidir, promise window in Alinhados), the
 * top-entry animation for new paid requests (B10.6 anim 7: springDefault
 * + 2 gold glow pulses) and the collapse path for reject/cancel.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { StaffRequestPayload } from "@/lib/realtime/events";
import type { Tier } from "@/lib/domain/types";
import { springDefault } from "@/lib/motion";
import { RequestCard, type RequestCardMode } from "@/components/ui/request-card";
import type { CockpitSessionConfig } from "./types";
import { formatEurosDisplay } from "./format";

export const NEW_GLOW_CSS = `
@keyframes bb-glow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 17, 45, 0); }
  50% { box-shadow: 0 0 0 1px rgba(232, 17, 45,.45), 0 8px 32px rgba(232, 17, 45,.22); }
}
.bb-new-request { animation: bb-glow-pulse 1.1s ease-in-out 2; }
@media (prefers-reduced-motion: reduce) {
  .bb-new-request { animation: none; }
}
`;

function decisionWindowMs(tier: Tier, config: CockpitSessionConfig): number {
  const minutes =
    tier === "NEXT"
      ? config.decisionWindowNextMin
      : tier === "SOON"
        ? config.decisionWindowSoonMin
        : config.decisionWindowQueueMin;
  return minutes * 60_000;
}

function promiseWindowMs(tier: Tier, config: CockpitSessionConfig): number | null {
  if (tier === "NEXT") return config.nextDeadlineMin * 60_000;
  if (tier === "SOON") return config.soonDeadlineMin * 60_000;
  return null; // QUEUE's promise is the end of the set
}

export interface CockpitRequestCardProps {
  request: StaffRequestPayload;
  mode: RequestCardMode;
  config: CockpitSessionConfig;
  isNew?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export function CockpitRequestCard({
  request,
  mode,
  config,
  isNew = false,
  actions,
  className,
}: CockpitRequestCardProps) {
  const t = useTranslations("cockpit");
  const tCommon = useTranslations("common");

  const deadlineIso =
    mode === "decide" ? request.decisionDeadlineAt : request.deadlineAt;
  const deadlineAt = deadlineIso ? Date.parse(deadlineIso) : null;
  const deadlineTotalMs =
    mode === "decide"
      ? decisionWindowMs(request.tier, config)
      : (promiseWindowMs(request.tier, config) ?? undefined);

  const fit =
    request.fitLabel === "fits" ||
    request.fitLabel === "possible" ||
    request.fitLabel === "off_style"
      ? request.fitLabel
      : null;

  return (
    <RequestCard
      mode={mode}
      layoutId={`request-${request.requestId}`}
      title={request.trackTitle}
      artist={request.trackArtist}
      coverUrl={request.coverUrl}
      bpm={request.trackBpm}
      camelotKey={request.trackKey}
      genre={request.trackGenre}
      zoneName={request.zoneName}
      tier={request.tier}
      tierLabel={tCommon(`tiers.${request.tier}`)}
      fit={fit}
      fitText={fit ? tCommon(`fit.${fit}`) : undefined}
      inLibrary={request.inLibrary}
      libraryText={request.inLibrary ? t("card.inLibrary") : t("card.outOfLibrary")}
      pinned={request.pinnedNext}
      pinnedText={t("queued.pinnedChip")}
      amountCents={request.amountCents}
      receiveLine={t("card.youReceive", {
        amount: formatEurosDisplay(request.djShareCents),
      })}
      deadlineAt={deadlineAt}
      deadlineTotalMs={deadlineAt !== null ? deadlineTotalMs : undefined}
      deadlineLabel={
        mode === "decide" ? t("decide.deadlineLabel") : t("queued.deadlineLabel")
      }
      message={request.message}
      hideMessageLabel={t("card.hideMessage")}
      actions={actions}
      className={[isNew ? "bb-new-request" : "", className ?? ""].join(" ")}
      // Enter from the top (B10.6 anim 7); leave by collapsing (anim 10).
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, height: 0, y: 0, overflow: "hidden" }}
      transition={springDefault}
      data-request-id={request.requestId}
      data-status={request.status}
    />
  );
}
