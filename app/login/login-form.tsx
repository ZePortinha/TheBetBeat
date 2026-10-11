"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { publicEnv } from "@/lib/security/public-env";
import { loginAction, type LoginState } from "./actions";

interface Labels {
  email: string;
  password: string;
  submit: string;
  errorInvalid: string;
  errorRateLimited: string;
  errorBot: string;
}

export function LoginForm({ next, labels }: { next: string; labels: Labels }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    null,
  );
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  // Turnstile (B12.4): the widget writes its token into the form as
  // `cf-turnstile-response`; the server requires it in production.
  useEffect(() => {
    const turnstile = window.turnstile;
    if (!scriptLoaded || !turnstile || !widgetRef.current || widgetIdRef.current) return;
    if (!publicEnv.turnstileSiteKey) return;
    widgetIdRef.current = turnstile.render(widgetRef.current, {
      sitekey: publicEnv.turnstileSiteKey,
      appearance: "interaction-only",
      size: "flexible",
      theme: "dark",
      callback: () => undefined,
    });
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [scriptLoaded]);

  // Tokens are single-use: after a failed attempt, get a fresh one.
  useEffect(() => {
    if (state?.error && widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }, [state]);

  const errorText =
    state?.error === "invalid"
      ? labels.errorInvalid
      : state?.error === "rate_limited"
        ? labels.errorRateLimited
        : state?.error === "bot"
          ? labels.errorBot
          : null;

  const inputCls =
    "min-h-12 w-full rounded-button bg-surface-2 border border-line-strong px-4 py-3 " +
    "text-base text-text-primary placeholder:text-text-tertiary " +
    "transition-[border-color,box-shadow] duration-100 " +
    "focus:border-accent-400 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onReady={() => setScriptLoaded(true)}
      />
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.email}</span>
        <input
          className={inputCls}
          type="email"
          name="email"
          autoComplete="email"
          required
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.password}</span>
        <input
          className={inputCls}
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      <div ref={widgetRef} />
      {errorText ? (
        <p role="alert" className="text-sm text-ember-500">
          {errorText}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-12 rounded-full bg-accent-500 px-4 py-3 text-base
          font-semibold text-text-on-accent transition-[background-color,transform] duration-100
          hover:bg-accent-400 active:scale-[0.97] active:bg-accent-700 disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}
