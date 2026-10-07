"use client";

/**
 * Guest-surface client providers (BRIEF B6 "Identidade sem registo"):
 *
 *  - Anonymous Supabase session on first visit (signInAnonymously) and
 *    an upsert of the guest's own `guests` row (RLS: own-row only). If
 *    Auth refuses, the guest sees a retry banner (never a silently stuck
 *    app) and, outside production, the console names the likely cause.
 *  - A shared Cloudflare Turnstile token: a subtle widget renders once
 *    per surface; routes that start payments require the token (B12.4).
 *    Turnstile tokens are single-use — `consumeToken` resets the widget
 *    after a protected action so the next action gets a fresh token.
 */

import * as React from "react";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/security/public-env";
import { Button } from "@/components/ui/button";

/** What Supabase Auth reports when the anonymous sign-in fails. */
interface AuthFailure {
  code?: string;
  status?: number;
  name?: string;
  message: string;
}

/**
 * Developer hint for the usual local causes (console only, never shown to
 * guests): the bare "sign-in failed" line gave nothing to act on.
 */
export function anonymousSignInHint(e: AuthFailure, supabaseUrl: string): string {
  const message = e.message.toLowerCase();
  if (e.code === "anonymous_provider_disabled" || message.includes("anonymous sign-ins are disabled")) {
    return "Anonymous sign-ins are off in this Supabase project: hosted, Authentication > Sign In / Providers > Allow anonymous sign-ins; local, enable_anonymous_sign_ins = true in supabase/config.toml, then supabase stop && supabase start.";
  }
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return "Too many anonymous sign-ins from this IP (supabase/config.toml [auth.rate_limit] anonymous_users). Wait, or raise the limit and restart Supabase.";
  }
  if (e.code === "captcha_failed" || message.includes("captcha")) {
    return "Supabase Auth has captcha protection on, and anonymous sign-in sends no captcha token: turn it off for development (Authentication > Attack Protection).";
  }
  if (e.status === 401 || e.status === 403 || message.includes("api key")) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY does not belong to this Supabase (local: supabase status -o env, ANON_KEY). Restart pnpm dev after changing it.";
  }
  if (e.name === "AuthRetryableFetchError" || !e.status || message.includes("fetch")) {
    return `The browser cannot reach NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl || "not set"}). Is Supabase running, and is that address reachable from this device?`;
  }
  return "See the Supabase Auth logs for this request.";
}

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
  /** Auth refused the anonymous session (the banner offers a retry). */
  failed: boolean;
  /** Current Turnstile token (null while solving / after consumption). */
  turnstileToken: string | null;
  /** Marks the token used and asks the widget for a fresh one. */
  consumeToken: () => void;
}

const GuestContext = React.createContext<GuestContextValue>({
  guestId: null,
  ready: false,
  failed: false,
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
  const [failed, setFailed] = React.useState(false);
  // Bumped by "Tentar outra vez": runs the sign-in again.
  const [attempt, setAttempt] = React.useState(0);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = React.useState(false);

  const widgetRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);

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
        const { data: anon, error } = await supabase.auth.signInAnonymously();
        if (error) {
          if (cancelled) return;
          const failure: AuthFailure = {
            code: (error as { code?: string }).code,
            status: error.status,
            name: error.name,
            message: error.message,
          };
          console.error(
            `[guest] anonymous sign-in failed: ${failure.message}` +
              ` (status ${failure.status ?? "none"}, code ${failure.code ?? "none"})`,
          );
          if (process.env.NODE_ENV !== "production") {
            console.error(`[guest] hint: ${anonymousSignInHint(failure, publicEnv.supabaseUrl)}`);
          }
          setFailed(true);
          return;
        }
        user = anon.user;
      }
      if (!user || cancelled) return;
      setFailed(false);
      // Own-row upsert (RLS guests_insert_own / guests_update_own).
      await supabase
        .from("guests")
        .upsert({ id: user.id, locale }, { onConflict: "id", ignoreDuplicates: true });
      if (!cancelled) {
        setGuestId(user.id);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, attempt]);

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

  const value = React.useMemo(
    () => ({ guestId, ready, failed, turnstileToken, consumeToken }),
    [guestId, ready, failed, turnstileToken, consumeToken],
  );

  return (
    <GuestContext.Provider value={value}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      {children}
      {failed ? <ConnectionBanner onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {/* Subtle anti-bot host: invisible with the interaction-only
          appearance unless Cloudflare needs a visible challenge. */}
      <div ref={widgetRef} className="fixed bottom-2 left-4 right-4 z-40" />
    </GuestContext.Provider>
  );
}

/** The guest could not get a session: say so, and offer to try again. */
function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("guest.connection");
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-[max(env(safe-area-inset-top),0.75rem)]"
    >
      <div className="closed-banner flex w-full max-w-md items-center gap-3 rounded-[1.375rem] p-3 ring-1 ring-line-strong">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ember-500">
          <WifiOff size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">{t("failed")}</span>
          <span className="block text-xs text-text-secondary">{t("hint")}</span>
        </span>
        <Button size="md" variant="secondary" onPress={onRetry}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
