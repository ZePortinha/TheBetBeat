"use client";

/**
 * "Os meus pedidos" (B6 screen 9): the guest's own history with receipts
 * and refunds, split into what is still in progress tonight and the rest.
 * Own data only (RLS + guest_id scoped route); tapping a row opens the
 * tracking screen. Private guest channel + polling keep it fresh.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pressable } from "@/components/ui/pressable";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { guestChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { BackHeader } from "./back-header";
import { MyBids } from "./auction-screens";
import { ACTIVE_REQUEST_STATUSES, type GuestRequestListItem } from "./types";

const POLL_MS = 15_000;

export function MyRequestsScreen({
  token,
  sessionId,
}: {
  token: string;
  sessionId: string;
}) {
  const t = useTranslations("guest.myRequests");
  const ts = useTranslations("guest.session");
  const tStatus = useTranslations("guest.status");
  const tTiers = useTranslations("common.tiers");
  const locale = useLocale();
  const router = useRouter();
  const { guestId, ready } = useGuest();

  const [requests, setRequests] = React.useState<GuestRequestListItem[] | null>(null);

  const refetch = React.useCallback(async () => {
    if (!ready) return;
    const res = await apiFetch<{ requests: GuestRequestListItem[] }>("/api/guest/requests");
    if (res.ok) setRequests(res.data.requests);
  }, [ready]);

  React.useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  useRealtimeChannel(ready && guestId ? guestChannel(guestId) : null, { private: true }, () => {
    void refetch();
  });

  const timeFmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Lisbon",
      }),
    [locale],
  );

  const active = (requests ?? []).filter(
    (r) => r.sessionId === sessionId && ACTIVE_REQUEST_STATUSES.includes(r.status),
  );
  const history = (requests ?? []).filter((r) => !active.includes(r));

  const statusLabel = (r: GuestRequestListItem): string =>
    r.status === "accepted" ? tStatus("queued") : tStatus(r.status);

  const moneyLine = (r: GuestRequestListItem): string => {
    const paid = formatEurosDisplay(r.amountCents);
    if (r.refundedCents > 0) {
      return `${paid} · ${t("refunded", { amount: formatEurosDisplay(r.refundedCents) })}`;
    }
    return paid;
  };

  const renderRow = (r: GuestRequestListItem) => (
    <Pressable
      key={r.requestId}
      onPress={() => router.push(`/s/${token}/requests/${r.requestId}`)}
      className="flex w-full items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-text-primary">{r.trackTitle}</p>
        <p className="truncate text-sm text-text-secondary">
          {statusLabel(r)} · {tTiers(r.tier)} · {timeFmt.format(new Date(r.createdAt))}
        </p>
        <p className="tnum mt-0.5 truncate text-sm text-text-tertiary">
          {moneyLine(r)}
          {r.invoiceRef ? ` · ${t("receipt", { ref: r.invoiceRef })}` : ""}
        </p>
      </div>
      <ChevronRight size={20} strokeWidth={1.75} className="shrink-0 text-text-tertiary" aria-hidden />
    </Pressable>
  );

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}`} />
      <MyBids token={token} sessionId={sessionId} />

      {requests === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={76} rounded="card" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t("empty")}
          hint={t("emptyHint")}
          action={
            <Button onPress={() => router.push(`/s/${token}/search`)}>
              {ts("requestCta")}
            </Button>
          }
        />
      ) : (
        <>
          {active.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label={t("active")}>
              <p className="label text-text-tertiary">{t("active")}</p>
              {active.map(renderRow)}
            </section>
          ) : null}
          {history.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label={t("history")}>
              <p className="label text-text-tertiary">{t("history")}</p>
              {history.map(renderRow)}
            </section>
          ) : null}
          <p className="text-center text-xs text-text-tertiary">{t("refundNote")}</p>
        </>
      )}
    </main>
  );
}
