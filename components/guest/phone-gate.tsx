"use client";

/**
 * The party's front door (2026-10-08): after the QR, the guest always
 * signs in with their phone number and the SMS code. A number that has
 * been here before comes back with its @ (it is not asked again); a new
 * number picks its @ once, and it stays with the number for every night
 * after. While SMS is still the mock provider, development shows the code
 * on screen (see /api/guest/phone).
 *
 * Later, with real SMS live, the bid form stops asking for an @ and offers
 * "anonymous" or "public" instead (not done yet: docs/DECISIONS.md).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { AtSign, MessageSquareText, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, errorMessage } from "./api";
import { useGuest } from "./guest-providers";
import { LocaleToggle } from "./locale-toggle";
import { Intro } from "./phone-login-screen";

type Step = "loading" | "phone" | "code" | "handle";

interface PhoneDto {
  phone: string | null;
  verified: boolean;
  handle: string | null;
}

const field =
  "min-h-14 w-full rounded-card bg-surface-1 text-text-primary outline-none " +
  "transition-shadow duration-100 focus-within:ring-2 focus-within:ring-accent-500";

const HANDLE = /^[a-z0-9][a-z0-9._-]{1,23}$/i;

export function PhoneGate({ venueName, onEntered }: { venueName: string; onEntered: () => void }) {
  const t = useTranslations("guest.gate");
  const ta = useTranslations("guest.account");
  const tPay = useTranslations("guest.payment");
  const tErr = useTranslations("guest.errors");
  const tc = useTranslations("common");
  const { ready, turnstileToken, consumeToken } = useGuest();

  const [step, setStep] = React.useState<Step>("loading");
  const [digits, setDigits] = React.useState("");
  const [code, setCode] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** Proven number: in with its @, or pick one first. */
  const after = React.useCallback(
    (dto: PhoneDto) => {
      if (dto.handle) onEntered();
      else setStep("handle");
    },
    [onEntered],
  );

  React.useEffect(() => {
    if (!ready) return;
    void (async () => {
      const res = await apiFetch<PhoneDto>("/api/guest/phone");
      if (res.ok && res.data.phone?.startsWith("+351")) setDigits(res.data.phone.slice(4));
      if (res.ok && res.data.verified) after(res.data);
      else setStep("phone");
    })();
  }, [ready, after]);

  const phone = `+351${digits}`;
  const phoneValid = /^9\d{8}$/.test(digits);
  const pretty = `+351 ${digits.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}`;
  const handleValue = handle.replace(/^@/, "");
  const handleValid = HANDLE.test(handleValue);
  const fail = (res: { code: string; id: string | null }) => setError(errorMessage((k, v) => tErr(k, v), res));

  async function sendCode() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ expiresAt: string; devCode?: string }>("/api/guest/phone", {
      method: "POST",
      body: JSON.stringify({ phone, turnstileToken: turnstileToken ?? "missing" }),
    });
    consumeToken();
    setBusy(false);
    if (!res.ok) return fail(res);
    setDevCode(res.data.devCode ?? null);
    setCode("");
    setStep("code");
  }

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch<PhoneDto>("/api/guest/phone", {
      method: "POST",
      body: JSON.stringify({ phone, code: value }),
    });
    setBusy(false);
    if (!res.ok) {
      setCode("");
      return fail(res);
    }
    navigator.vibrate?.(20);
    after(res.data);
  }

  async function saveHandle() {
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ ok: boolean }>("/api/guest/profile", {
      method: "POST",
      body: JSON.stringify({ handle: handleValue.toLowerCase(), rankingOptin: true }),
    });
    setBusy(false);
    if (!res.ok) return res.code === "handle_taken" ? setError(t("handleTaken")) : fail(res);
    onEntered();
  }

  const errorLine = error ? (
    <p role="alert" className="text-center text-sm text-ember-500">
      {error}
    </p>
  ) : null;

  return (
    <main className="flex min-h-dvh flex-col gap-8 px-5 pb-10 pt-5">
      <header className="flex min-h-11 items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <span className="text-accent-400">{tc("appName")}</span>
          <span aria-hidden className="text-text-tertiary">
            ×
          </span>
          <span className="truncate text-text-primary">{venueName}</span>
        </p>
        <LocaleToggle />
      </header>

      {step === "loading" ? <Skeleton height={300} rounded="card" /> : null}

      {step === "phone" ? (
        <section className="flex flex-col gap-6">
          <Intro Icon={Smartphone} title={t("title")} hint={t("hint")} />
          <div>
            <label htmlFor="gate-phone" className="label mb-2 block text-text-tertiary">
              {ta("phoneLabel")}
            </label>
            <div className={`${field} flex items-center gap-3 px-4`}>
              <span className="tnum text-base text-text-secondary">+351</span>
              <input
                id="gate-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={9}
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                aria-invalid={digits.length > 0 && !phoneValid}
                className="tnum min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:outline-none"
              />
            </div>
            {digits.length > 0 && !phoneValid ? <p className="mt-2 text-sm text-amber-500">{tPay("phoneInvalid")}</p> : null}
          </div>
          {errorLine}
          <Button fullWidth size="lg" loading={busy} disabled={!phoneValid} onPress={() => void sendCode()}>
            {ta("sendCode")}
          </Button>
          <p className="text-center text-sm text-text-tertiary">{t("note")}</p>
        </section>
      ) : null}

      {step === "code" ? (
        <section className="flex flex-col gap-6">
          <Intro Icon={MessageSquareText} title={ta("codeTitle")} hint={ta("codeHint", { phone: pretty })} />
          {/* one-time-code: iOS and Android offer the SMS code above the keyboard. */}
          <input
            aria-label={ta("codeLabel")}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(value);
              if (value.length === 6 && !busy) void verify(value);
            }}
            className={`${field} tnum min-h-16 text-center text-3xl font-semibold tracking-[0.4em]`}
          />
          {devCode ? (
            <p className="rounded-card border border-dashed border-line-strong px-3 py-2 text-center text-sm text-text-tertiary">
              {ta("devCode", { code: devCode })}
            </p>
          ) : null}
          {errorLine}
          <Button fullWidth size="lg" loading={busy} disabled={code.length !== 6} onPress={() => void verify(code)}>
            {ta("verify")}
          </Button>
          <div className="flex justify-center gap-8">
            <Pressable onPress={() => void sendCode()} disabled={busy} className="min-h-11 text-base font-medium text-accent-400">
              {ta("resend")}
            </Pressable>
            <Pressable
              onPress={() => {
                setError(null);
                setStep("phone");
              }}
              className="min-h-11 text-base font-medium text-accent-400"
            >
              {ta("changeNumber")}
            </Pressable>
          </div>
        </section>
      ) : null}

      {step === "handle" ? (
        <section className="flex flex-col gap-6">
          <Intro Icon={AtSign} title={t("handleTitle")} hint={t("handleHint")} />
          <div>
            <label htmlFor="gate-handle" className="label mb-2 block text-text-tertiary">
              {t("handleLabel")}
            </label>
            <div className={`${field} flex items-center gap-1 px-4`}>
              <span className="text-base text-text-secondary">@</span>
              <input
                id="gate-handle"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={24}
                autoFocus
                placeholder={t("handlePlaceholder")}
                value={handleValue}
                onChange={(e) => setHandle(e.target.value.replace(/\s/g, "").slice(0, 24))}
                aria-invalid={handleValue.length > 0 && !handleValid}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-tertiary focus-visible:outline-none"
              />
            </div>
            {handleValue.length > 0 && !handleValid ? (
              <p className="mt-2 text-sm text-amber-500">{t("handleInvalid")}</p>
            ) : null}
          </div>
          {errorLine}
          <Button fullWidth size="lg" loading={busy} disabled={!handleValid} onPress={() => void saveHandle()}>
            {t("enter")}
          </Button>
        </section>
      ) : null}
    </main>
  );
}
