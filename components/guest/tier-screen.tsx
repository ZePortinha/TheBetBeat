"use client";

/**
 * Tier screen (B6 screen 3): TrackHero + the three tier promises, free
 * extra value, the guarantee, and a fixed CTA with the total. A quote is
 * created on entry (POST /api/guest/quotes), shows its 120 s validity and
 * auto-refreshes when it expires — prices roll via PriceTag's odometer.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Skeleton } from "@/components/ui/skeleton";
import { TierCard } from "@/components/ui/tier-card";
import { TrackHero } from "@/components/ui/track-hero";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import type { Tier } from "@/lib/domain/types";
import { apiFetch, errorMessage, type ApiResult } from "./api";
import { useGuest } from "./guest-providers";
import { BackHeader } from "./back-header";
import { PaymentSheet } from "./payment-sheet";
import type { CreateRequestResponse, QuoteDto } from "./types";

const TIER_ORDER: Tier[] = ["QUEUE", "SOON", "NEXT"];

export function TierScreen({ token, trackId }: { token: string; trackId: string }) {
  const t = useTranslations("guest.tier");
  const tTiers = useTranslations("common.tiers");
  const tErr = useTranslations("guest.errors");
  const locale = useLocale();
  const router = useRouter();
  const { ready, turnstileToken, consumeToken } = useGuest();

  const [quote, setQuote] = React.useState<QuoteDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Tier>("QUEUE");
  const [extraCents, setExtraCents] = React.useState(0);
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const quoteRef = React.useRef<QuoteDto | null>(null);
  quoteRef.current = quote;

  const fetchQuote = React.useCallback(async (): Promise<QuoteDto | null> => {
    setRefreshing(true);
    const res = await apiFetch<QuoteDto>("/api/guest/quotes", {
      method: "POST",
      body: JSON.stringify({ token, trackId }),
    });
    setRefreshing(false);
    if (!res.ok) {
      setError(errorMessage((k, v) => tErr(k, v), res));
      return null;
    }
    setError(null);
    setQuote(res.data);
    return res.data;
  }, [token, trackId, tErr]);

  React.useEffect(() => {
    if (!ready) return;
    void fetchQuote().then((q) => {
      if (!q) return;
      // Preselect the cheapest available tier.
      const first = TIER_ORDER.find(
        (tier) => q.tiers.find((x) => x.tier === tier)?.available,
      );
      if (first) setSelected(first);
    });
  }, [ready, fetchQuote]);

  // Quote validity countdown + auto-refresh on expiry (B4.3: 120 s TTL).
  React.useEffect(() => {
    if (!quote) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) void fetchQuote();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote, fetchQuote]);

  const tierDto = quote?.tiers.find((x) => x.tier === selected) ?? null;
  const maxExtra = tierDto ? Math.max(0, tierDto.maxCents - tierDto.priceCents) : 0;
  const boundedExtra = Math.min(extraCents, maxExtra);
  const totalCents = (tierDto?.priceCents ?? 0) + boundedExtra;

  /**
   * Creates the request with a GUARANTEED-fresh quote: if ours expired
   * (e.g. the guest lingered in the sheet), refresh first and re-price
   * the same tier. The server re-validates everything regardless.
   */
  const submitPayment = React.useCallback(
    async (args: {
      method: "mbway" | "card" | "apple_pay" | "google_pay";
      phone?: string;
      email?: string;
      nif?: string;
    }): Promise<ApiResult<CreateRequestResponse>> => {
      let q = quoteRef.current;
      if (!q || Date.parse(q.expiresAt) - Date.now() < 3_000) {
        q = await fetchQuote();
        if (!q) return { ok: false, code: "quote_expired", id: null, status: 409 };
      }
      const dto = q.tiers.find((x) => x.tier === selected);
      if (!dto || !dto.available) {
        return { ok: false, code: "tier_unavailable", id: null, status: 409 };
      }
      const amount = Math.min(dto.maxCents, dto.priceCents + boundedExtra);
      const res = await apiFetch<CreateRequestResponse>("/api/guest/requests", {
        method: "POST",
        body: JSON.stringify({
          quoteId: q.quoteId,
          tier: selected,
          amountCents: amount,
          method: args.method,
          ...(args.phone ? { phone: args.phone } : {}),
          ...(args.email ? { email: args.email } : {}),
          ...(args.nif ? { nif: args.nif } : {}),
          turnstileToken: turnstileToken ?? "missing",
        }),
      });
      consumeToken();
      if (!res.ok && res.code === "quote_expired") {
        void fetchQuote();
      }
      return res;
    },
    [selected, boundedExtra, fetchQuote, turnstileToken, consumeToken],
  );

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-40 pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}/search`} />

      {quote ? (
        <TrackHero
          title={quote.track.title}
          artist={quote.track.artist}
          genre={quote.track.genre}
          bpm={quote.track.bpm}
          camelotKey={quote.track.camelotKey}
        />
      ) : (
        <Skeleton height={96} rounded="card" />
      )}

      {error ? (
        <div className="rounded-card border border-line-subtle bg-surface-1 px-4 py-4 text-sm text-text-secondary">
          {error}
        </div>
      ) : null}

      {/* Tier cards */}
      <section className="flex flex-col gap-3" aria-label={t("title")}>
        {quote
          ? TIER_ORDER.map((tier) => {
              const dto = quote.tiers.find((x) => x.tier === tier);
              if (!dto) return null;
              return (
                <TierCard
                  key={tier}
                  tier={tier}
                  name={tTiers(tier)}
                  promise={t(`promise.${tier}`)}
                  priceCents={dto.priceCents}
                  etaLabel={`~${dto.etaDisplayMin} min`}
                  available={dto.available}
                  {...(!dto.available && dto.reason
                    ? { unavailableReason: t(`unavailable.${dto.reason}`) }
                    : {})}
                  selected={selected === tier}
                  onSelect={() => {
                    setSelected(tier);
                    setExtraCents(0);
                  }}
                />
              );
            })
          : Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={92} rounded="card" />
            ))}
      </section>

      {/* Free extra value (B4.1 "Valor livre") */}
      {tierDto?.available ? (
        <section className="rounded-card border border-line-subtle bg-surface-1 px-4 py-4">
          <p className="text-base font-semibold text-text-primary">{t("extraLabel")}</p>
          <p className="mt-1 text-sm text-text-secondary">{t("extraHint")}</p>
          <div className="mt-3 flex items-center justify-between">
            <Pressable
              onPress={() => setExtraCents((v) => Math.max(0, Math.min(v, maxExtra) - 100))}
              disabled={boundedExtra <= 0}
              aria-label={t("decreaseExtra")}
              className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-text-primary disabled:opacity-40"
            >
              <Minus size={20} strokeWidth={1.75} aria-hidden />
            </Pressable>
            <span className="tnum text-xl font-bold text-gold-500">
              +{formatEurosDisplay(boundedExtra)}
            </span>
            <Pressable
              onPress={() => setExtraCents((v) => Math.min(maxExtra, Math.min(v, maxExtra) + 100))}
              disabled={boundedExtra >= maxExtra}
              aria-label={t("increaseExtra")}
              className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-text-primary disabled:opacity-40"
            >
              <Plus size={20} strokeWidth={1.75} aria-hidden />
            </Pressable>
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            {t("extraMax", { max: formatEurosDisplay(tierDto.maxCents) })}
          </p>
        </section>
      ) : null}

      <p className="text-center text-sm text-text-secondary">{t("guarantee")}</p>

      {/* Fixed CTA with the total (B10.4 material + safe area) */}
      <div className="material fixed inset-x-0 bottom-0 z-30">
        <div className="mx-auto w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
          <div className="mb-2 flex items-center justify-between text-xs text-text-tertiary">
            <span>{t("vatIncluded")}</span>
            <span className="tnum" aria-live="polite">
              {refreshing
                ? t("quoteRefreshing")
                : secondsLeft !== null
                  ? t("quoteValid", { seconds: secondsLeft })
                  : ""}
            </span>
          </div>
          <Button
            fullWidth
            size="lg"
            disabled={!tierDto?.available || refreshing}
            onPress={() => setSheetOpen(true)}
          >
            {t("payCta", { total: formatEurosDisplay(totalCents) })}
          </Button>
        </div>
      </div>

      <PaymentSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        totalCents={totalCents}
        locale={locale}
        submit={submitPayment}
        onTracked={(requestId) => router.push(`/s/${token}/requests/${requestId}`)}
      />
    </main>
  );
}
