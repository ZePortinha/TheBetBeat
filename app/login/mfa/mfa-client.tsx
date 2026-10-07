"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Labels {
  enrollIntro: string;
  verifyIntro: string;
  codeLabel: string;
  submit: string;
  error: string;
  loading: string;
  qrAlt: string;
}

type Mode = "loading" | "enroll" | "verify";

/**
 * TOTP MFA for managers/admins (B12.3): enrolls a factor on first login
 * (QR + secret), then challenges on every session until AAL2.
 */
export function MfaClient({ next, labels }: { next: string; labels: Labels }) {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMode("verify");
        return;
      }
      const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "BetBeat TOTP",
      });
      if (cancelled) return;
      if (enrollErr || !enrollData) {
        setError(true);
        setMode("verify");
        return;
      }
      setFactorId(enrollData.id);
      setQrSvg(enrollData.totp.qr_code);
      setSecret(enrollData.totp.secret);
      setMode("enroll");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!factorId || busy) return;
      setBusy(true);
      setError(false);
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (chErr || !challenge) {
        setError(true);
        setBusy(false);
        return;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (vErr) {
        setError(true);
        setBusy(false);
        return;
      }
      router.push(next);
    },
    [factorId, busy, code, next, router, supabase],
  );

  if (mode === "loading") {
    return <p className="text-sm text-text-secondary">{labels.loading}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        {mode === "enroll" ? labels.enrollIntro : labels.verifyIntro}
      </p>
      {mode === "enroll" && qrSvg ? (
        <div className="self-center rounded-card bg-white p-3">
          {/* Supabase returns an SVG data URI for the otpauth QR. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSvg} alt={labels.qrAlt} width={180} height={180} />
        </div>
      ) : null}
      {mode === "enroll" && secret ? (
        <p className="break-all text-center text-xs text-text-tertiary tnum">{secret}</p>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.codeLabel}</span>
        <input
          className="w-full rounded-button border border-line-subtle bg-surface-3 px-4
            py-3 text-center text-xl tracking-[0.3em] text-text-primary tnum
            focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-ember-500">
          {labels.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="min-h-12 rounded-full bg-accent-500 px-4 py-3 text-base font-semibold
          text-text-on-accent transition-[background-color,transform] duration-100
          hover:bg-accent-400 active:scale-[0.97] active:bg-accent-700 disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}
