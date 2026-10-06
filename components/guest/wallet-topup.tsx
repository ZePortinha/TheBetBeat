"use client";

/**
 * "Carregar saldo": load the balance once, then every bid is instant (no
 * MB WAY wait in the last seconds of an auction). Amounts as chips (no
 * keyboard), the same method picker as bids, the MB WAY wait with the
 * dev panel in development. What is not spent goes back at the end.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { PaymentMethod } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { Pressable, cx } from "@/components/ui/pressable";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch, errorMessage } from "./api";
import { MethodPicker, useSavedPhoneDigits } from "./bid-form";
import { DevPanelInline } from "./dev-panel";
import { useGuest } from "./guest-providers";

const AMOUNTS = [1000, 2000, 5000, 10_000];

export function TopUpForm({
  token,
  methods,
  onDone,
}: {
  token: string;
  methods: PaymentMethod[];
  onDone: () => void;
}) {
  const t = useTranslations("guest.auction.topup");
  const tPay = useTranslations("guest.payment");
  const tErr = useTranslations("guest.errors");
  const { turnstileToken, consumeToken } = useGuest();
  const [amount, setAmount] = React.useState(2000);
  const [method, setMethod] = React.useState<PaymentMethod>(methods[0] ?? "mbway");
  const [phoneDigits, setPhoneDigits] = useSavedPhoneDigits();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [waiting, setWaiting] = React.useState<{ intentId: string; expiresAt: number | null } | null>(null);
  const [done, setDone] = React.useState(false);

  // MB WAY push out: poll until the money lands in the balance.
  React.useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void apiFetch<{ status: string }>(`/api/guest/auction/intents/${waiting.intentId}`).then((res) => {
        if (!res.ok || res.data.status === "pending") return;
        setWaiting(null);
        if (res.data.status === "credited") setDone(true);
        else setError(t("failed"));
      });
    }, 2000);
    return () => clearInterval(id);
  }, [waiting, t]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ state: string; intentId: string; expiresAt: string | null }>("/api/guest/wallet/topup", {
      method: "POST",
      body: JSON.stringify({
        token,
        amountCents: amount,
        method,
        ...(method === "mbway" ? { phone: `+351${phoneDigits}` } : {}),
        turnstileToken: turnstileToken ?? "missing",
      }),
    });
    consumeToken();
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage((k, v) => tErr(k, v), res));
      return;
    }
    if (res.data.state === "credited") {
      navigator.vibrate?.(20);
      setDone(true);
    } else if (res.data.state === "pending") {
      setWaiting({ intentId: res.data.intentId, expiresAt: res.data.expiresAt ? Date.parse(res.data.expiresAt) : null });
    } else {
      setError(t("failed"));
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <p className="text-xl font-bold text-text-primary">{t("doneTitle")}</p>
        <p className="text-sm text-text-secondary">{t("doneHint")}</p>
        <Button fullWidth onPress={onDone}>
          {t("close")}
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

  const canSubmit = !busy && (method !== "mbway" || /^9\d{8}$/.test(phoneDigits));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t("amount")}>
        {AMOUNTS.map((value) => (
          <Pressable
            key={value}
            role="radio"
            aria-checked={amount === value}
            onPress={() => setAmount(value)}
            className={cx(
              "tnum flex min-h-14 items-center justify-center rounded-card border text-lg font-bold",
              amount === value ? "border-accent-500 bg-surface-2 text-accent-400" : "border-line-subtle bg-surface-1 text-text-primary",
            )}
          >
            {formatEurosDisplay(value)}
          </Pressable>
        ))}
      </div>
      <MethodPicker
        methods={methods}
        method={method}
        onMethod={setMethod}
        phoneDigits={phoneDigits}
        onPhoneDigits={setPhoneDigits}
      />
      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {error}
        </p>
      ) : null}
      <Button fullWidth size="lg" loading={busy} disabled={!canSubmit} onPress={() => void submit()}>
        {t("cta", { amount: formatEurosDisplay(amount) })}
      </Button>
      <p className="text-center text-xs text-text-tertiary">{t("leftover")}</p>
    </div>
  );
}
