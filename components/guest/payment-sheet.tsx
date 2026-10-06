"use client";

/**
 * Payment sheet (B6 screen 4, B4.3):
 *
 *  - Method order: MB WAY first on pt-PT devices, wallets first otherwise.
 *    Apple Pay / Google Pay buttons are VISUAL (B4.3 mock phase): they run
 *    the same instant-authorize mock path as card — documented; Phase 8
 *    swaps the real wallet sheets behind the same call.
 *  - MB WAY: +351 phone validated as you type, countdown ring while the
 *    push is out (expiresAt from the API), "Reenviar" after expiry.
 *  - Confirmed: check draw + three Beat Pulse rings + a short vibration,
 *    on the same frame (B10.6 anim 4), honoring reduced motion.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { Smartphone, CreditCard, Wallet } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { durations } from "@/lib/motion";
import type { PaymentMethod } from "@/lib/domain/types";
import { apiFetch, errorMessage, type ApiResult } from "./api";
import { DevPanelInline } from "./dev-panel";
import type { CreateRequestResponse, GuestRequestDetail } from "./types";

type Phase = "method" | "waiting" | "confirmed" | "failed" | "expired";

export interface PaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalCents: number;
  locale: string;
  submit: (args: {
    method: PaymentMethod;
    phone?: string;
    email?: string;
    nif?: string;
  }) => Promise<ApiResult<CreateRequestResponse>>;
  /** Navigate to the tracking screen for this request. */
  onTracked: (requestId: string) => void;
}

/** Portuguese NIF check digit (inline validation only; server re-checks). */
export function nifLooksValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i += 1) sum += Number(digits[i]) * (9 - i);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === Number(digits[8]);
}

export function PaymentSheet({
  open,
  onOpenChange,
  totalCents,
  locale,
  submit,
  onTracked,
}: PaymentSheetProps) {
  const t = useTranslations("guest.payment");
  const tErr = useTranslations("guest.errors");

  const [phase, setPhase] = React.useState<Phase>("method");
  const [method, setMethod] = React.useState<PaymentMethod>(
    locale === "pt-PT" ? "mbway" : "apple_pay",
  );
  const [phoneDigits, setPhoneDigits] = React.useState("");
  const [savedDigits, setSavedDigits] = React.useState<string | null>(null);
  const [showNif, setShowNif] = React.useState(false);
  const [nif, setNif] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [requestId, setRequestId] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null);

  const methods: PaymentMethod[] =
    locale === "pt-PT"
      ? ["mbway", "apple_pay", "google_pay", "card"]
      : ["apple_pay", "google_pay", "mbway", "card"];

  const phoneValid = /^9\d{8}$/.test(phoneDigits);
  const emailValid = email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nifValid = !showNif || nif === "" || nifLooksValid(nif);
  const canConfirm =
    !submitting && emailValid && nifValid && (method !== "mbway" || phoneValid);

  // Reset when the sheet reopens for a new attempt.
  React.useEffect(() => {
    if (open) {
      setPhase("method");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Pre-fill MB WAY with the saved number (phone sign-in or last payment).
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void apiFetch<{ phone: string | null }>("/api/guest/phone").then((res) => {
      const saved = res.ok && res.data.phone?.startsWith("+351") ? res.data.phone.slice(4) : null;
      if (cancelled || !saved) return;
      setSavedDigits(saved);
      setPhoneDigits((typed) => typed || saved);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // While an MB WAY push is out: poll the request until it settles.
  React.useEffect(() => {
    if (phase !== "waiting" || !requestId) return;
    const id = setInterval(() => {
      void (async () => {
        const res = await apiFetch<GuestRequestDetail>(`/api/guest/requests/${requestId}`);
        if (!res.ok) return;
        const status = res.data.status;
        if (status === "paid" || status === "accepted" || status === "playing") {
          setPhase("confirmed");
        } else if (res.data.payment?.status === "failed") {
          // A declined push also expires the request: check the payment first.
          setPhase("failed");
        } else if (status === "expired") {
          setPhase("expired");
        }
      })();
    }, 2500);
    return () => clearInterval(id);
  }, [phase, requestId]);

  // The parent passes inline callbacks and re-renders every second (quote
  // countdown): keep them in a ref so the hand-off timer is not restarted.
  const handoffRef = React.useRef({ onOpenChange, onTracked });
  handoffRef.current = { onOpenChange, onTracked };

  // Confirmed: play the animation, then hand off to tracking.
  React.useEffect(() => {
    if (phase !== "confirmed" || !requestId) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(30);
    }
    const id = setTimeout(() => {
      handoffRef.current.onOpenChange(false);
      handoffRef.current.onTracked(requestId);
    }, 1200);
    return () => clearTimeout(id);
  }, [phase, requestId]);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    const res = await submit({
      method,
      ...(method === "mbway" ? { phone: `+351${phoneDigits}` } : {}),
      ...(email ? { email } : {}),
      ...(showNif && nif ? { nif } : {}),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(errorMessage((k, v) => tErr(k, v), res));
      return;
    }
    setRequestId(res.data.requestId);
    if (res.data.status === "paid") {
      setPhase("confirmed");
    } else if (res.data.payment.status === "failed") {
      setPhase("failed");
    } else {
      setExpiresAt(
        res.data.payment.expiresAt ? Date.parse(res.data.payment.expiresAt) : Date.now() + 4 * 60_000,
      );
      setPhase("waiting");
    }
  }

  const methodMeta: Record<PaymentMethod, { icon: React.ReactNode }> = {
    mbway: { icon: <Smartphone size={20} strokeWidth={1.75} aria-hidden /> },
    apple_pay: { icon: <Wallet size={20} strokeWidth={1.75} aria-hidden /> },
    google_pay: { icon: <Wallet size={20} strokeWidth={1.75} aria-hidden /> },
    card: { icon: <CreditCard size={20} strokeWidth={1.75} aria-hidden /> },
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // Closing during the wait keeps the request alive — the guest can
        // follow it on the tracking screen instead.
        if (!next && phase === "waiting" && requestId) onTracked(requestId);
      }}
      title={t("title")}
      scaleBackground
    >
      <div className="flex flex-col gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2">
        {phase === "method" ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{t("total")}</span>
              <span className="tnum text-2xl font-bold text-accent-400">
                {formatEurosDisplay(totalCents)}
              </span>
            </div>

            {/* Method picker */}
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("title")}>
              {methods.map((m) => (
                <Pressable
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  onPress={() => setMethod(m)}
                  className={`flex items-center gap-2 rounded-button border px-3 py-3 text-base font-semibold ${
                    method === m
                      ? "border-accent-500 bg-surface-2 text-text-primary"
                      : "border-line-subtle bg-surface-1 text-text-secondary"
                  }`}
                >
                  {methodMeta[m].icon}
                  <span className="truncate">{t(`methods.${m}`)}</span>
                </Pressable>
              ))}
            </div>

            {method === "mbway" ? (
              <div>
                <label className="label mb-1 block text-text-tertiary" htmlFor="mbway-phone">
                  {t("phoneLabel")}
                </label>
                <div className="flex items-center gap-2 rounded-button border border-line-subtle bg-surface-3 px-4 py-3 focus-within:border-accent-500">
                  <span className="tnum text-base text-text-secondary">+351</span>
                  <input
                    id="mbway-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={9}
                    value={phoneDigits}
                    onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    className="tnum w-full bg-transparent text-base text-text-primary outline-none"
                    aria-invalid={phoneDigits.length > 0 && !phoneValid}
                  />
                </div>
                {phoneDigits.length > 0 && !phoneValid ? (
                  <p className="mt-1 text-sm text-amber-500">{t("phoneInvalid")}</p>
                ) : phoneDigits === savedDigits ? (
                  <p className="mt-1 text-sm text-text-tertiary">{t("phoneSaved")}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary">{t("walletNote")}</p>
            )}

            {/* Optional NIF + email (B4.5 invoice-receipt) */}
            <Pressable
              onPress={() => setShowNif((v) => !v)}
              aria-expanded={showNif}
              className="text-left text-sm font-medium text-text-secondary underline underline-offset-4"
            >
              {t("nifToggle")}
            </Pressable>
            {showNif ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="label mb-1 block text-text-tertiary" htmlFor="nif">
                    {t("nifLabel")}
                  </label>
                  <input
                    id="nif"
                    type="text"
                    inputMode="numeric"
                    maxLength={9}
                    value={nif}
                    onChange={(e) => setNif(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    className="tnum w-full rounded-button border border-line-subtle bg-surface-3 px-4 py-3 text-base text-text-primary outline-none focus:border-accent-500"
                    aria-invalid={nif.length === 9 && !nifLooksValid(nif)}
                  />
                  {nif.length === 9 && !nifLooksValid(nif) ? (
                    <p className="mt-1 text-sm text-amber-500">{t("nifInvalid")}</p>
                  ) : null}
                </div>
                <div>
                  <label className="label mb-1 block text-text-tertiary" htmlFor="receipt-email">
                    {t("emailLabel")}
                  </label>
                  <input
                    id="receipt-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-button border border-line-subtle bg-surface-3 px-4 py-3 text-base text-text-primary outline-none focus:border-accent-500"
                    aria-invalid={!emailValid}
                  />
                  {!emailValid ? (
                    <p className="mt-1 text-sm text-amber-500">{t("emailInvalid")}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="text-sm text-ember-500" role="alert">
                {error}
              </p>
            ) : null}

            <Button fullWidth size="lg" loading={submitting} disabled={!canConfirm} onPress={() => void confirm()}>
              {t("confirmCta", { total: formatEurosDisplay(totalCents) })}
            </Button>
            <p className="text-center text-xs text-text-tertiary">{t("secureNote")}</p>
          </>
        ) : null}

        {phase === "waiting" && expiresAt !== null ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CountdownRing
              deadlineAt={expiresAt}
              durationMs={4 * 60_000}
              size={120}
              label={t("waitingTitle")}
            >
              {(remainingMs: number) => (
                <MbwayWait remainingMs={remainingMs} />
              )}
            </CountdownRing>
            <div>
              <p className="text-lg font-semibold text-text-primary">{t("waitingTitle")}</p>
              <p className="mt-1 text-sm text-text-secondary">
                {t("waitingHint", {
                  phone: `+351 ${phoneDigits.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}`,
                  minutes: 4,
                })}
              </p>
            </div>
            {requestId ? <DevPanelInline /> : null}
          </div>
        ) : null}

        {phase === "expired" ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="text-lg font-semibold text-text-primary">{t("expiredTitle")}</p>
            <p className="text-sm text-text-secondary">{t("expiredHint")}</p>
            <Button
              fullWidth
              onPress={() => {
                setPhase("method");
                setError(null);
              }}
            >
              {t("resend")}
            </Button>
          </div>
        ) : null}

        {phase === "failed" ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="text-lg font-semibold text-text-primary">{t("failedTitle")}</p>
            <p className="text-sm text-text-secondary">{t("failedHint")}</p>
            <Button
              fullWidth
              onPress={() => {
                setPhase("method");
                setError(null);
              }}
            >
              {t("resend")}
            </Button>
          </div>
        ) : null}

        {phase === "confirmed" ? (
          <PaymentConfirmedAnim title={t("confirmedTitle")} hint={t("confirmedHint")} />
        ) : null}
      </div>
    </BottomSheet>
  );
}

function MbwayWait({ remainingMs }: { remainingMs: number }) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return (
    <div className="flex flex-col items-center">
      <Smartphone size={20} strokeWidth={1.75} className="animate-pulse text-accent-400" aria-hidden />
      <span className="tnum mt-1 text-sm font-semibold text-text-primary">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
    </div>
  );
}

/**
 * B10.6 animation 4: in the same frame, the check draws (`base`), three
 * Beat Pulse rings expand (600 ms) and a short vibration fires (caller).
 * Reduced motion → static check, no rings.
 */
export function PaymentConfirmedAnim({ title, hint }: { title: string; hint?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
      <div className="relative flex size-24 items-center justify-center">
        {!reduced
          ? [0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute inset-0 rounded-full border-2 border-green-500"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1.9 + i * 0.35, opacity: 0 }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: "easeOut" }}
                aria-hidden
              />
            ))
          : null}
        <svg viewBox="0 0 48 48" className="size-16" aria-hidden>
          <circle cx="24" cy="24" r="22" fill="none" stroke="var(--color-green-500)" strokeWidth="2" opacity="0.4" />
          <motion.path
            d="M14 25 L21 32 L34 17"
            fill="none"
            stroke="var(--color-green-500)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: durations.base, ease: [0.2, 0, 0, 1] }}
          />
        </svg>
      </div>
      <div>
        <p className="text-lg font-semibold text-text-primary">{title}</p>
        {hint ? <p className="mt-1 text-sm text-text-secondary">{hint}</p> : null}
      </div>
    </div>
  );
}
