"use client";

/**
 * Tracking screen (B6 screens 5 e 6): Pago → Aceite → Na fila → A tocar →
 * Tocou with live position/ETA (poll + private guest channel), the
 * "Subir de nível" sheet, plainly-worded demotions/refunds, and the
 * celebratory "Tocou" state with the native share card.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleX, RotateCcw } from "lucide-react";
import { StatusStepper } from "@/components/ui/status-stepper";
import { TrackHero } from "@/components/ui/track-hero";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { toast } from "@/components/ui/toast";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { guestChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import type { Tier } from "@/lib/domain/types";
import { apiFetch, errorMessage } from "./api";
import { useGuest } from "./guest-providers";
import { BackHeader } from "./back-header";
import { DevPanel, DevPanelInline } from "./dev-panel";
import { PaymentConfirmedAnim } from "./payment-sheet";
import type { GuestRequestDetail, UpgradePreviewDto, UpgradeResultDto } from "./types";

const POLL_MS = 5000;

export function TrackingScreen({
  token,
  requestId,
}: {
  token: string;
  requestId: string;
}) {
  const t = useTranslations("guest.tracking");
  const tPay = useTranslations("guest.payment");
  const tTiers = useTranslations("common.tiers");
  const router = useRouter();
  const { guestId, ready } = useGuest();

  const [detail, setDetail] = React.useState<GuestRequestDetail | null>(null);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);

  const refetch = React.useCallback(async () => {
    const res = await apiFetch<GuestRequestDetail>(`/api/guest/requests/${requestId}`);
    if (res.ok) setDetail(res.data);
  }, [requestId]);

  React.useEffect(() => {
    if (!ready) return;
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(id);
  }, [ready, refetch]);

  useRealtimeChannel(ready && guestId ? guestChannel(guestId) : null, { private: true }, () => {
    void refetch();
  });

  if (!detail) {
    return (
      <main className="flex min-h-dvh flex-col gap-4 px-4 pb-10 pt-6">
        <BackHeader title={t("title")} backHref={`/s/${token}`} />
        <Skeleton height={96} rounded="card" />
        <Skeleton height={160} rounded="card" />
        <DevPanel />
      </main>
    );
  }

  const steps = [
    t("steps.paid"),
    t("steps.accepted"),
    t("steps.queued"),
    t("steps.playing"),
    t("steps.played"),
  ];

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-28 pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}`} />

      {detail.status !== "played" ? (
        <TrackHero title={detail.trackTitle} artist={detail.trackArtist} coverUrl={detail.coverUrl} />
      ) : null}

      {/* Demotion explained plainly (B6.5) */}
      {detail.demotedFrom && detail.refundedCents > 0 && detail.status !== "refunded" ? (
        <div className="rounded-card border border-line-strong bg-surface-1 px-4 py-3 text-sm text-text-primary">
          {t("demoted", { amount: formatEurosDisplay(detail.refundedCents) })}
        </div>
      ) : null}

      {detail.status === "pending_payment" ? (
        <PendingPayment detail={detail} />
      ) : detail.status === "expired" ? (
        <EndState
          icon={<CircleX size={24} strokeWidth={1.75} aria-hidden />}
          title={t("expiredTitle")}
          hint={t("expiredHint")}
          actionLabel={t("requestAgain")}
          onAction={() => router.push(`/s/${token}/search`)}
        />
      ) : detail.status === "refunded" ? (
        <EndState
          icon={<RotateCcw size={24} strokeWidth={1.75} aria-hidden />}
          title={t("refundedTitle", { amount: formatEurosDisplay(detail.refundedCents || detail.amountCents) })}
          hint={
            detail.closeReason && detail.closeReason !== "payment_timeout"
              ? t(`refundedByReason.${detail.closeReason}`)
              : t("expiredHint")
          }
          actionLabel={t("requestAgain")}
          onAction={() => router.push(`/s/${token}/search`)}
        />
      ) : detail.status === "played" ? (
        <PlayedCelebration token={token} detail={detail} requestId={requestId} />
      ) : (
        <>
          <StatusStepper
            steps={steps}
            activeIndex={
              detail.status === "paid" ? 0 : detail.status === "accepted" ? 2 : 3
            }
            detail={
              detail.status === "paid" ? (
                <span>{t("paidLine")}</span>
              ) : detail.status === "accepted" && detail.etaMin !== null ? (
                <span className="tnum">
                  {detail.queuePosition !== null
                    ? t("position", { position: detail.queuePosition, eta: detail.etaMin })
                    : t("etaOnly", { eta: detail.etaMin })}
                </span>
              ) : detail.status === "playing" ? (
                <span>{t("playingLine")}</span>
              ) : null
            }
          />

          {detail.status !== "playing" && detail.tier !== "NEXT" ? (
            <Button variant="secondary" fullWidth onPress={() => setUpgradeOpen(true)}>
              {t("upgradeCta")}
            </Button>
          ) : null}
        </>
      )}

      <UpgradeSheet
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        requestId={requestId}
        currentTier={detail.tier}
        tierName={(tier) => tTiers(tier)}
        onChanged={() => void refetch()}
        mbwayWaitTitle={tPay("waitingTitle")}
      />
      <DevPanel />
    </main>
  );
}

/** Landed here with the MB WAY push still out (sheet closed early). */
function PendingPayment({ detail }: { detail: GuestRequestDetail }) {
  const t = useTranslations("guest.payment");
  const expiresAt = detail.payment?.expiresAt ? Date.parse(detail.payment.expiresAt) : null;
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line-subtle bg-surface-1 px-4 py-6 text-center">
      {expiresAt ? (
        <CountdownRing deadlineAt={expiresAt} durationMs={4 * 60_000} size={104} label={t("waitingTitle")} />
      ) : null}
      <p className="text-base font-semibold text-text-primary">{t("waitingTitle")}</p>
      <DevPanelInline />
    </div>
  );
}

function EndState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line-subtle bg-surface-1 px-4 py-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-surface-3 text-text-secondary">
        {icon}
      </div>
      <p className="text-lg font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary">{hint}</p>
      <Button variant="secondary" onPress={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

/** B6.6 "Tocou": Beat Pulse rings + check draw, native share. */
function PlayedCelebration({
  token,
  detail,
  requestId,
}: {
  token: string;
  detail: GuestRequestDetail;
  requestId: string;
}) {
  const t = useTranslations("guest.played");
  const tt = useTranslations("guest.tracking");
  const router = useRouter();
  const [sharing, setSharing] = React.useState(false);

  async function share() {
    setSharing(true);
    const url = `/api/guest/requests/${requestId}/card?format=story`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("card fetch failed");
      const blob = await res.blob();
      const file = new File([blob], "betbeat-tocou.png", { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: t("shareHeadline") });
      } else {
        window.open(url, "_blank", "noopener");
      }
    } catch {
      toast({ title: t("shareError"), variant: "error" });
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <PaymentConfirmedAnim
        title={t("title")}
        hint={t("subtitle", { track: detail.trackTitle })}
      />
      <Button fullWidth size="lg" loading={sharing} onPress={() => void share()}>
        {t("share")}
      </Button>
      <Button variant="ghost" fullWidth onPress={() => router.push(`/s/${token}`)}>
        {tt("backToSession")}
      </Button>
    </div>
  );
}

/** "Subir de nível" (B4.1): pay only the difference; deadline restarts. */
function UpgradeSheet({
  open,
  onOpenChange,
  requestId,
  currentTier,
  tierName,
  onChanged,
  mbwayWaitTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  currentTier: Tier;
  tierName: (tier: Tier) => string;
  onChanged: () => void;
  mbwayWaitTitle: string;
}) {
  const t = useTranslations("guest.tracking");
  const tErr = useTranslations("guest.errors");
  const { turnstileToken, consumeToken } = useGuest();

  const [preview, setPreview] = React.useState<UpgradePreviewDto | null>(null);
  const [submitting, setSubmitting] = React.useState<Tier | null>(null);
  const [waiting, setWaiting] = React.useState<{ expiresAt: number | null; toTier: Tier } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPreview(null);
    setWaiting(null);
    setError(null);
    void (async () => {
      const res = await apiFetch<UpgradePreviewDto>(`/api/guest/requests/${requestId}/upgrade`);
      if (res.ok) setPreview(res.data);
      else setError(errorMessage((k, v) => tErr(k, v), res));
    })();
  }, [open, requestId, tErr]);

  // While an MB WAY difference is pending, poll until the tier flips.
  React.useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void (async () => {
        const res = await apiFetch<{ tier: Tier }>(`/api/guest/requests/${requestId}`);
        if (res.ok && res.data.tier === waiting.toTier) {
          toast({ title: t("upgradeApplied", { tier: tierName(waiting.toTier) }), variant: "success" });
          onChanged();
          onOpenChange(false);
        }
      })();
    }, 2500);
    return () => clearInterval(id);
  }, [waiting, requestId, onChanged, onOpenChange, t, tierName]);

  async function upgrade(toTier: Tier) {
    if (toTier !== "SOON" && toTier !== "NEXT") return;
    setSubmitting(toTier);
    setError(null);
    const res = await apiFetch<UpgradeResultDto>(`/api/guest/requests/${requestId}/upgrade`, {
      method: "POST",
      body: JSON.stringify({ toTier, turnstileToken: turnstileToken ?? "missing" }),
    });
    consumeToken();
    setSubmitting(null);
    if (!res.ok) {
      setError(errorMessage((k, v) => tErr(k, v), res));
      return;
    }
    if (res.data.state === "applied") {
      toast({ title: t("upgradeApplied", { tier: tierName(toTier) }), variant: "success" });
      onChanged();
      onOpenChange(false);
    } else {
      setWaiting({
        expiresAt: res.data.payment?.expiresAt ? Date.parse(res.data.payment.expiresAt) : null,
        toTier,
      });
    }
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={t("upgradeTitle")} scaleBackground>
      <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2">
        {waiting ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            {waiting.expiresAt ? (
              <CountdownRing deadlineAt={waiting.expiresAt} durationMs={4 * 60_000} size={104} label={mbwayWaitTitle} />
            ) : null}
            <p className="text-base font-semibold text-text-primary">{mbwayWaitTitle}</p>
            <DevPanelInline />
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary">{t("upgradeHint")}</p>
            {preview === null && !error ? <Skeleton height={80} rounded="card" /> : null}
            {preview?.options
              .filter((o) => o.tier !== currentTier)
              .map((o) => (
                <div
                  key={o.tier}
                  className={`rounded-card border px-4 py-3 ${
                    o.available ? "border-line-strong bg-surface-1" : "border-line-subtle bg-surface-1 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-text-primary">{tierName(o.tier)}</p>
                      <p className="tnum text-sm text-text-secondary">~{o.etaDisplayMin} min</p>
                    </div>
                    <span className="tnum text-lg font-bold text-accent-400">
                      {o.diffCents > 0
                        ? t("upgradeDiff", { diff: formatEurosDisplay(o.diffCents) })
                        : t("upgradeIncluded")}
                    </span>
                  </div>
                  {o.available ? (
                    <Button
                      fullWidth
                      className="mt-3"
                      loading={submitting === o.tier}
                      onPress={() => void upgrade(o.tier)}
                    >
                      {t("upgradeConfirm", { tier: tierName(o.tier) })}
                    </Button>
                  ) : (
                    <p className="mt-2 text-sm text-text-tertiary">{t("upgradeUnavailable")}</p>
                  )}
                </div>
              ))}
            {preview && preview.options.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-tertiary">{t("upgradeUnavailable")}</p>
            ) : null}
            {error ? (
              <p className="text-sm text-ember-500" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
