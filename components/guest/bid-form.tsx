"use client";

/**
 * Bid form (slot auctions): quick totals instead of a keyboard, how I
 * appear, what comes from my balance and what is charged, then the
 * payment (MB WAY push or card/wallet at once). Shared by the track screen
 * (my own bid) and the sheet on the auction card (raise / back a bid).
 * The server is the judge: it re-checks everything on its own clock.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { CreditCard, Smartphone, Wallet } from "lucide-react";
import type { PublicAuctionState, PublicSlot } from "@/lib/auction/service";
import type { PaymentMethod } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Pressable, cx } from "@/components/ui/pressable";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch, errorMessage } from "./api";
import { DevPanelInline } from "./dev-panel";
import { useGuest } from "./guest-providers";

export type BidTargetInput =
  | { kind: "own"; trackId: string }
  | { kind: "back"; bidId: string };

type Display = { mode: "anonymous" } | { mode: "handle"; handle: string } | { mode: "table"; table: string };

/** The three quick totals: +steps over the top, lifted to the minimum. */
export function quickTotals(slot: PublicSlot, steps: readonly number[], trackFloorCents = 0): number[] {
  const floor = Math.max(slot.minNextCents, trackFloorCents);
  const top = slot.top?.totalCents ?? null;
  const totals =
    top === null
      ? [floor, floor + (steps[1] ?? 0) - (steps[0] ?? 0), floor + (steps[2] ?? 0) - (steps[0] ?? 0)]
      : steps.map((s) => Math.max(top + s, floor));
  return [...new Set(totals)];
}

/** Payment method radios + the MB WAY number (shared by bids and "Carregar saldo"). */
export function MethodPicker({
  methods,
  method,
  onMethod,
  phoneDigits,
  onPhoneDigits,
}: {
  methods: PaymentMethod[];
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  phoneDigits: string;
  onPhoneDigits: (digits: string) => void;
}) {
  const tPay = useTranslations("guest.payment");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tPay("title")}>
        {methods.map((m) => (
          <Pressable
            key={m}
            role="radio"
            aria-checked={method === m}
            onPress={() => onMethod(m)}
            className={cx(
              "flex min-h-12 items-center gap-2 rounded-button border px-3 text-sm font-semibold",
              method === m ? "border-accent-500 bg-surface-2 text-text-primary" : "border-line-subtle bg-surface-1 text-text-secondary",
            )}
          >
            {m === "mbway" ? <Smartphone size={18} aria-hidden /> : m === "card" ? <CreditCard size={18} aria-hidden /> : <Wallet size={18} aria-hidden />}
            {tPay(`methods.${m}`)}
          </Pressable>
        ))}
      </div>
      {method === "mbway" ? (
        <div className="flex min-h-12 items-center gap-2 rounded-button border border-line-subtle bg-surface-3 px-4 focus-within:border-accent-500">
          <span className="tnum text-base text-text-secondary">+351</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={9}
            aria-label={tPay("phoneLabel")}
            value={phoneDigits}
            onChange={(e) => onPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
            className="tnum w-full bg-transparent text-base text-text-primary outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}

/** The guest's saved MB WAY number (phone sign-in or last payment), digits after +351. */
export function useSavedPhoneDigits(): [string, (d: string) => void] {
  const [digits, setDigits] = React.useState("");
  React.useEffect(() => {
    void apiFetch<{ phone: string | null }>("/api/guest/phone").then((res) => {
      if (res.ok && res.data.phone?.startsWith("+351")) setDigits((d) => d || res.data.phone!.slice(4));
    });
  }, []);
  return [digits, setDigits];
}

const HANDLE_KEY = "betbeat:handle";

/** The @ used last time on this phone (empty the first time). */
function savedHandle(): string {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function BidForm({
  token,
  slot,
  rules,
  target,
  currentBidTotal,
  walletCents,
  methods,
  trackFloorCents = 0,
  initialTotal,
  onDone,
}: {
  token: string;
  slot: PublicSlot;
  rules: PublicAuctionState["rules"];
  target: BidTargetInput;
  /** Total already behind the bid this action strengthens (0 if new/outbid). */
  currentBidTotal: number;
  walletCents: number;
  /** What the server can charge right now (production with ifthenpay: MB WAY only). */
  methods: PaymentMethod[];
  /** This track's starting price for its transition (new own bids only). */
  trackFloorCents?: number;
  initialTotal?: number;
  onDone: () => void;
}) {
  const t = useTranslations("guest.auction");
  const tPay = useTranslations("guest.payment");
  const tErr = useTranslations("guest.errors");
  const { turnstileToken, consumeToken } = useGuest();

  const totals = quickTotals(slot, rules.quickBidStepsCents, trackFloorCents);
  const [total, setTotal] = React.useState(() =>
    initialTotal && initialTotal >= slot.minNextCents ? initialTotal : (totals[0] ?? slot.minNextCents),
  );
  // Someone raised meanwhile: never sit below the new minimum.
  const effectiveTotal = Math.max(total, slot.minNextCents, trackFloorCents);
  // "O meu @" is the default: bidding is social. Anonymous and table are one tap away.
  const [display, setDisplay] = React.useState<Display>({ mode: "handle", handle: "" });
  React.useEffect(() => {
    const handle = savedHandle();
    if (handle) setDisplay((d) => (d.mode === "handle" && !d.handle ? { mode: "handle", handle } : d));
  }, []);
  const [method, setMethod] = React.useState<PaymentMethod>(methods[0] ?? "mbway");
  const [phoneDigits, setPhoneDigits] = useSavedPhoneDigits();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [waiting, setWaiting] = React.useState<{ intentId: string; expiresAt: number | null } | null>(null);
  const [result, setResult] = React.useState<"placed" | "superseded" | null>(null);

  const add = Math.max(0, effectiveTotal - currentBidTotal);
  const fromWallet = Math.min(walletCents, add);
  const toPay = add - fromWallet;
  const phoneValid = /^9\d{8}$/.test(phoneDigits);
  const displayValid =
    display.mode === "anonymous" ||
    (display.mode === "handle" && /^@?[a-z0-9][a-z0-9._-]{1,23}$/i.test(display.handle)) ||
    (display.mode === "table" && display.table.trim().length > 0);
  const canSubmit = !busy && displayValid && (toPay === 0 || method !== "mbway" || phoneValid);

  // MB WAY push out: poll the waiting bid until the money lands.
  React.useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void apiFetch<{ status: string }>(`/api/guest/auction/intents/${waiting.intentId}`).then((res) => {
        if (!res.ok || res.data.status === "pending") return;
        setWaiting(null);
        if (res.data.status === "placed") setResult("placed");
        else if (res.data.status === "superseded") setResult("superseded");
        else setError(t("paymentFailed"));
      });
    }, 2000);
    return () => clearInterval(id);
  }, [waiting, t]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ state: string; intentId?: string; expiresAt?: string | null }>(
      "/api/guest/auction/bid",
      {
        method: "POST",
        body: JSON.stringify({
          token,
          slotId: slot.id,
          totalCents: effectiveTotal,
          target,
          display,
          ...(toPay > 0 ? { method } : {}),
          ...(toPay > 0 && method === "mbway" ? { phone: `+351${phoneDigits}` } : {}),
          ...(toPay > 0 ? { turnstileToken: turnstileToken ?? "missing" } : {}),
        }),
      },
    );
    if (toPay > 0) consumeToken();
    setBusy(false);
    if (res.ok && display.mode === "handle") {
      try {
        localStorage.setItem(HANDLE_KEY, display.handle);
      } catch {
        // Storage blocked: typed again next time.
      }
    }
    if (!res.ok) {
      // 402 = the wallet changed: the form already shows how to pay.
      if (res.status !== 402) setError(errorMessage((k, v) => tErr(k, v), res));
      return;
    }
    if (res.data.state === "placed") {
      navigator.vibrate?.(20);
      setResult("placed");
    } else if (res.data.state === "pending" && res.data.intentId) {
      setWaiting({
        intentId: res.data.intentId,
        expiresAt: res.data.expiresAt ? Date.parse(res.data.expiresAt) : null,
      });
    } else if (res.data.state === "superseded") {
      setResult("superseded");
    } else {
      setError(t("paymentFailed"));
    }
  }

  if (result) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <p className="text-xl font-bold text-text-primary">
          {result === "placed" ? t("placedTitle") : t("supersededTitle")}
        </p>
        <p className="text-sm text-text-secondary">
          {result === "placed" ? t("placedHint") : t("supersededHint")}
        </p>
        <Button fullWidth onPress={onDone}>
          {t("done")}
        </Button>
      </div>
    );
  }

  if (waiting) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {waiting.expiresAt ? (
          <CountdownRing deadlineAt={waiting.expiresAt} durationMs={4 * 60_000} size={112} label={tPay("waitingTitle")} />
        ) : null}
        <p className="text-lg font-semibold text-text-primary">{tPay("waitingTitle")}</p>
        <p className="text-sm text-text-secondary">{t("waitingHint")}</p>
        <DevPanelInline />
      </div>
    );
  }

  const chip = (active: boolean) =>
    cx(
      "min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors",
      active ? "border-accent-500 bg-accent-500 text-text-on-accent" : "border-line-strong bg-surface-2 text-text-primary",
    );

  return (
    <div className="flex flex-col gap-5">
      {/* Quick totals (+1 € / +5 € / +10 €) — no keyboard on a dark floor. */}
      <div>
        <p className="label mb-2 text-text-secondary">{t("yourBid")}</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("yourBid")}>
          {totals.map((amount) => (
            <Pressable
              key={amount}
              role="radio"
              aria-checked={effectiveTotal === amount}
              onPress={() => setTotal(amount)}
              className={cx(
                "tnum flex min-h-14 flex-col items-center justify-center rounded-card border text-lg font-bold",
                effectiveTotal === amount
                  ? "border-accent-500 bg-surface-2 text-accent-400"
                  : "border-line-subtle bg-surface-1 text-text-primary",
              )}
            >
              {formatEurosDisplay(amount)}
            </Pressable>
          ))}
        </div>
      </div>

      {/* How I appear (@ / table / anonymous — never a real name). */}
      {target.kind === "own" ? (
        <div>
          <p className="label mb-2 text-text-secondary">{t("appearAs")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={chip(display.mode === "handle")}
              onClick={() => setDisplay({ mode: "handle", handle: display.mode === "handle" ? display.handle : savedHandle() })}
            >
              {t("appearHandle")}
            </button>
            <button type="button" className={chip(display.mode === "anonymous")} onClick={() => setDisplay({ mode: "anonymous" })}>
              {t("appearAnonymous")}
            </button>
            <button
              type="button"
              className={chip(display.mode === "table")}
              onClick={() => setDisplay({ mode: "table", table: display.mode === "table" ? display.table : "" })}
            >
              {t("appearTable")}
            </button>
          </div>
          {display.mode === "handle" ? (
            <div className="mt-2 flex min-h-12 items-center gap-1 rounded-button border border-line-subtle bg-surface-3 px-3 focus-within:border-accent-500">
              <span className="text-base text-text-tertiary">@</span>
              <input
                aria-label={t("appearHandle")}
                value={display.handle}
                maxLength={24}
                onChange={(e) => setDisplay({ mode: "handle", handle: e.target.value.replace(/^@/, "") })}
                placeholder={t("handlePlaceholder")}
                className="w-full bg-transparent text-base text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </div>
          ) : display.mode === "table" ? (
            <input
              aria-label={t("appearTable")}
              value={display.table}
              maxLength={20}
              onChange={(e) => setDisplay({ mode: "table", table: e.target.value })}
              placeholder={t("tablePlaceholder")}
              className="mt-2 min-h-12 w-full rounded-button border border-line-subtle bg-surface-3 px-3 text-base text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent-500"
            />
          ) : null}
          <p className="mt-2 text-xs text-text-tertiary">
            {t("appearHint", { amount: formatEurosDisplay(rules.screenNameCents) })}
          </p>
        </div>
      ) : null}

      {/* What comes from the balance and what is charged. */}
      <div className="rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>{target.kind === "back" ? t("backingWith") : t("bidTotal")}</span>
          <span className="tnum font-semibold text-text-primary">
            {formatEurosDisplay(target.kind === "back" ? add : effectiveTotal)}
          </span>
        </div>
        {fromWallet > 0 ? (
          <div className="mt-1 flex justify-between text-text-secondary">
            <span>{t("fromWallet")}</span>
            <span className="tnum">−{formatEurosDisplay(fromWallet)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between border-t border-line-subtle pt-2 font-semibold text-text-primary">
          <span>{t("toPay")}</span>
          <span className="tnum text-accent-400">{formatEurosDisplay(toPay)}</span>
        </div>
      </div>

      {toPay > 0 ? (
        <MethodPicker
          methods={methods}
          method={method}
          onMethod={setMethod}
          phoneDigits={phoneDigits}
          onPhoneDigits={setPhoneDigits}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {error}
        </p>
      ) : null}

      <Button fullWidth size="lg" loading={busy} disabled={!canSubmit} onPress={() => void submit()}>
        {target.kind === "back"
          ? t("backCta", { amount: formatEurosDisplay(add) })
          : t("bidCta", { amount: formatEurosDisplay(effectiveTotal) })}
      </Button>
      <p className="text-center text-xs text-text-tertiary">{t("rulesNote")}</p>
    </div>
  );
}
