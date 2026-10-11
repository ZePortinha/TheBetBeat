"use client";

/**
 * Guest phone sign-in (2026-10-05): number, then the 6-digit SMS code,
 * then signed in. The number is the account (2026-10-10): a number seen
 * before signs this browser in as that guest. The verified number is kept
 * encrypted server-side and pre-fills MB WAY in the payment sheet.
 *
 * Without a `token` (the /entrar page) it is the party login: once the
 * number is proven, the guest lands in the live party whose guest list
 * holds it; a guest already signed in goes straight there.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, MessageSquareText, SearchX, Smartphone, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, errorMessage } from "./api";
import { BackHeader } from "./back-header";
import { useGuest } from "./guest-providers";

type Step = "loading" | "phone" | "code" | "signedIn" | "noParty";

interface PhoneDto {
  phone: string | null;
  verified: boolean;
  partyHref: string | null;
  /** The number already has an account: this browser signs in as it. */
  session?: { accessToken: string; refreshToken: string };
}

const field =
  "min-h-14 w-full rounded-card bg-surface-1 text-text-primary outline-none " +
  "transition-shadow duration-100 focus-within:ring-2 focus-within:ring-accent-500";

export function Intro({
  Icon,
  title,
  hint,
  tone = "accent",
}: {
  Icon: LucideIcon;
  title: string;
  hint: string;
  tone?: "accent" | "green";
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={`flex size-14 items-center justify-center rounded-[14px] text-text-on-accent ${
          tone === "green" ? "bg-green-500" : "bg-accent-500"
        }`}
      >
        <Icon size={28} strokeWidth={2} aria-hidden />
      </span>
      <h2 className="mt-5 text-2xl font-bold text-text-primary">
        {title}
      </h2>
      <p className="mt-2 max-w-[34ch] text-base leading-relaxed text-text-secondary">{hint}</p>
    </div>
  );
}

export function PhoneLoginScreen({ token }: { token?: string }) {
  const t = useTranslations("guest.account");
  const tPay = useTranslations("guest.payment");
  const tErr = useTranslations("guest.errors");
  const router = useRouter();
  const { ready, turnstileToken, consumeToken } = useGuest();
  const partyMode = token === undefined;

  const [step, setStep] = React.useState<Step>("loading");
  const [digits, setDigits] = React.useState("");
  const [code, setCode] = React.useState("");
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** After a proven number: into the party (party mode) or signed in. */
  const land = React.useCallback(
    (partyHref: string | null) => {
      if (!partyMode) return setStep("signedIn");
      if (partyHref) return router.replace(partyHref);
      setStep("noParty");
    },
    [partyMode, router],
  );

  React.useEffect(() => {
    if (!ready) return;
    void (async () => {
      const res = await apiFetch<PhoneDto>("/api/guest/phone");
      if (res.ok && res.data.phone?.startsWith("+351")) setDigits(res.data.phone.slice(4));
      if (res.ok && res.data.verified) land(res.data.partyHref);
      else setStep("phone");
    })();
  }, [ready, land]);

  const phone = `+351${digits}`;
  const phoneValid = /^9\d{8}$/.test(digits);
  const pretty = `+351 ${digits.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}`;
  const fail = (res: { code: string; id: string | null }) =>
    setError(errorMessage((k, v) => tErr(k, v), res));

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
    if (res.data.session) {
      // A number seen before: this browser becomes that guest.
      setBusy(true);
      const { error: sessionError } = await createClient().auth.setSession({
        access_token: res.data.session.accessToken,
        refresh_token: res.data.session.refreshToken,
      });
      setBusy(false);
      if (sessionError) return setError(tErr("login_failed"));
    }
    land(res.data.partyHref);
  }

  /** Sign out on this phone only: the account (number, @, balance) stays. */
  async function signOut() {
    setBusy(true);
    setError(null);
    await createClient().auth.signOut({ scope: "local" });
    window.location.assign(token ? `/s/${token}` : "/entrar");
  }

  const errorLine = error ? (
    <p role="alert" className="text-center text-sm text-ember-500">
      {error}
    </p>
  ) : null;

  return (
    <main className="flex min-h-dvh flex-col gap-8 px-5 pb-10 pt-5">
      <BackHeader
        title={partyMode ? t("partyTitle") : t("title")}
        backHref={partyMode ? "/" : `/s/${token}`}
      />

      {step === "loading" ? <Skeleton height={260} rounded="card" /> : null}

      {step === "phone" ? (
        <section className="flex flex-col gap-6">
          <Intro
            Icon={Smartphone}
            title={t("phoneTitle")}
            hint={partyMode ? t("partyHint") : t("phoneHint")}
          />
          <div>
            <label htmlFor="login-phone" className="label mb-2 block text-text-tertiary">
              {t("phoneLabel")}
            </label>
            <div className={`${field} flex items-center gap-3 px-4`}>
              <span className="tnum text-base text-text-secondary">+351</span>
              <input
                id="login-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={9}
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                aria-invalid={digits.length > 0 && !phoneValid}
                className="tnum min-w-0 flex-1 bg-transparent text-base outline-none"
              />
            </div>
            {digits.length > 0 && !phoneValid ? (
              <p className="mt-2 text-sm text-amber-500">{tPay("phoneInvalid")}</p>
            ) : null}
          </div>
          {errorLine}
          <Button
            fullWidth
            size="lg"
            loading={busy}
            disabled={!phoneValid}
            onPress={() => void sendCode()}
          >
            {t("sendCode")}
          </Button>
          <p className="text-center text-sm text-text-tertiary">
            {partyMode ? t("partyQrNote") : t("optionalNote")}
          </p>
        </section>
      ) : null}

      {step === "noParty" ? (
        <section className="flex flex-col gap-6">
          <Intro
            Icon={SearchX}
            title={t("noPartyTitle")}
            hint={t("noPartyHint", { phone: pretty })}
          />
          <Button
            fullWidth
            size="lg"
            onPress={() => {
              setError(null);
              setStep("phone");
            }}
          >
            {t("otherNumber")}
          </Button>
        </section>
      ) : null}

      {step === "code" ? (
        <section className="flex flex-col gap-6">
          <Intro
            Icon={MessageSquareText}
            title={t("codeTitle")}
            hint={t("codeHint", { phone: pretty })}
          />
          {/* one-time-code: iOS and Android offer the SMS code above the keyboard. */}
          <input
            aria-label={t("codeLabel")}
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
              {t("devCode", { code: devCode })}
            </p>
          ) : null}
          {errorLine}
          <Button
            fullWidth
            size="lg"
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => void verify(code)}
          >
            {t("verify")}
          </Button>
          <div className="flex justify-center gap-8">
            <Pressable
              onPress={() => void sendCode()}
              disabled={busy}
              className="min-h-11 text-base font-medium text-accent-400"
            >
              {t("resend")}
            </Pressable>
            <Pressable
              onPress={() => {
                setError(null);
                setStep("phone");
              }}
              className="min-h-11 text-base font-medium text-accent-400"
            >
              {t("changeNumber")}
            </Pressable>
          </div>
        </section>
      ) : null}

      {step === "signedIn" ? (
        <section className="flex flex-col gap-6">
          <Intro Icon={Check} tone="green" title={t("signedInTitle")} hint={t("signedInHint")} />
          <div className="flex min-h-14 items-center justify-between rounded-card bg-surface-1 px-4">
            <span className="text-base text-text-primary">{t("phoneRow")}</span>
            <span className="tnum text-base text-text-secondary">{pretty}</span>
          </div>
          {errorLine}
          <Button fullWidth size="lg" onPress={() => router.push(`/s/${token}`)}>
            {t("backToSet")}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            loading={busy}
            onPress={() => void signOut()}
            className="text-ember-500!"
          >
            {t("signOut")}
          </Button>
        </section>
      ) : null}
    </main>
  );
}
