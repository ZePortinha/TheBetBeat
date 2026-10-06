"use client";

/**
 * Guest-surface client providers (BRIEF B6 "Identidade sem registo"):
 *
 *  - Anonymous Supabase session on first visit (signInAnonymously) and
 *    an upsert of the guest's own `guests` row (RLS: own-row only).
 *  - A shared Cloudflare Turnstile token: a subtle widget renders once
 *    per surface; routes that start payments require the token (B12.4).
 *    Turnstile tokens are single-use — `consumeToken` resets the widget
 *    after a protected action so the next action gets a fresh token.
 */

import * as React from "react";
import Script from "next/script";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/security/public-env";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          appearance?: "always" | "execute" | "interaction-only";
          size?: "normal" | "compact" | "flexible";
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface GuestContextValue {
  /** The anonymous auth uid (owner of quotes/requests), once signed in. */
  guestId: string | null;
  /** True when the anonymous session is established. */
  ready: boolean;
  /** Current Turnstile token (null while solving / after consumption). */
  turnstileToken: string | null;
  /** Marks the token used and asks the widget for a fresh one. */
  consumeToken: () => void;
}

const GuestContext = React.createContext<GuestContextValue>({
  guestId: null,
  ready: false,
  turnstileToken: null,
  consumeToken: () => {},
});

export function useGuest(): GuestContextValue {
  return React.useContext(GuestContext);
}

export function GuestProviders({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  const [guestId, setGuestId] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = React.useState(false);

  const widgetRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);

  // Set when a new anonymous session must wait for a Turnstile token
  // (Supabase Auth CAPTCHA on, NEXT_PUBLIC_SUPABASE_CAPTCHA=1).
  const [needsCaptchaSignIn, setNeedsCaptchaSignIn] = React.useState(false);

  /** Own-row upsert (RLS guests_insert_own / guests_update_own), then ready. */
  const adopt = React.useCallback(
    async (userId: string, isCancelled: () => boolean) => {
      await createClient()
        .from("guests")
        .upsert({ id: userId, locale }, { onConflict: "id", ignoreDuplicates: true });
      if (!isCancelled()) {
        setGuestId(userId);
        setReady(true);
      }
    },
    [locale],
  );

  // ── Anonymous session + own guests row (B6) ───────────────────────
  React.useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      // getUser() validates the stored token against Auth. getSession()
      // only reads the cookie: after a `db:reset` (or a token for a user
      // that no longer exists) it reported a session that every API call
      // then rejected with 401. A stale cookie is dropped and replaced.
      const { data, error: userError } = await supabase.auth.getUser();
      let user = userError ? null : data.user;
      if (!user) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        if (publicEnv.supabaseCaptcha) {
          if (!cancelled) setNeedsCaptchaSignIn(true);
          return;
        }
        const { data: anon, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.error("[guest] anonymous sign-in failed");
          return;
        }
        user = anon.user;
      }
      if (!user || cancelled) return;
      await adopt(user.id, () => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  // ── Turnstile widget (subtle; invisible until interaction needed) ──
  React.useEffect(() => {
    if (!scriptLoaded || !widgetRef.current || widgetIdRef.current) return;
    const turnstile = window.turnstile;
    if (!turnstile || !publicEnv.turnstileSiteKey) return;
    widgetIdRef.current = turnstile.render(widgetRef.current, {
      sitekey: publicEnv.turnstileSiteKey,
      appearance: "interaction-only",
      size: "flexible",
      theme: "dark",
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [scriptLoaded]);

  const consumeToken = React.useCallback(() => {
    setTurnstileToken(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  // ── Anonymous sign-in behind Supabase CAPTCHA (B12.4) ──────────────
  const captchaInFlight = React.useRef(false);
  React.useEffect(() => {
    if (!needsCaptchaSignIn || !turnstileToken || captchaInFlight.current) return;
    captchaInFlight.current = true;
    const captchaToken = turnstileToken;
    // Single-use token: the widget starts on a fresh one for the next action.
    consumeToken();
    void (async () => {
      const { data: anon, error } = await createClient().auth.signInAnonymously({
        options: { captchaToken },
      });
      captchaInFlight.current = false;
      // A refused token: keep waiting, the widget produces a fresh one.
      if (error || !anon.user) {
        console.error("[guest] anonymous sign-in failed");
        return;
      }
      setNeedsCaptchaSignIn(false);
      await adopt(anon.user.id, () => false);
    })();
  }, [needsCaptchaSignIn, turnstileToken, consumeToken, adopt]);

  const value = React.useMemo(
    () => ({ guestId, ready, turnstileToken, consumeToken }),
    [guestId, ready, turnstileToken, consumeToken],
  );

  return (
    <GuestContext.Provider value={value}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      {children}
      {/* Subtle anti-bot host: invisible with the interaction-only
          appearance unless Cloudflare needs a visible challenge. */}
      <div ref={widgetRef} className="fixed bottom-2 left-4 right-4 z-40" />
    </GuestContext.Provider>
  );
}
