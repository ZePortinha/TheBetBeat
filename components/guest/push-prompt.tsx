"use client";

/**
 * Opt-in for web push, asked at the moment it means something: once the
 * guest has a bid in play. Hidden where push cannot work (iOS outside the
 * home-screen app, push off on the server) and after a "no". When already
 * allowed, the device is re-registered quietly (new phone, new link).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "./api";

const LATER_KEY = "betbeat:push-later";

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function subscribe(token: string): Promise<boolean> {
  const res = await apiFetch<{ publicKey: string | null }>("/api/guest/push");
  if (!res.ok || !res.data.publicKey) return false;
  const reg = await navigator.serviceWorker.register("/sw-guest.js", { scope: "/s/" });
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(res.data.publicKey) }));
  const json = sub.toJSON();
  const saved = await apiFetch("/api/guest/push", {
    method: "POST",
    body: JSON.stringify({ token, endpoint: json.endpoint, keys: json.keys }),
  });
  return saved.ok;
}

export function PushPrompt({ token, show }: { token: string; show: boolean }) {
  const t = useTranslations("guest.auction.push");
  const [ask, setAsk] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!show || !supported()) return;
    if (Notification.permission === "granted") {
      void subscribe(token).catch(() => undefined);
      return;
    }
    let later = false;
    try {
      later = localStorage.getItem(LATER_KEY) === "1";
    } catch {
      // Storage blocked: just ask.
    }
    if (Notification.permission !== "default" || later) return;
    void apiFetch<{ publicKey: string | null }>("/api/guest/push").then((res) => setAsk(res.ok && Boolean(res.data.publicKey)));
  }, [show, token]);

  if (!ask) return null;

  async function enable() {
    setBusy(true);
    const permission = await Notification.requestPermission();
    if (permission === "granted") await subscribe(token).catch(() => false);
    setBusy(false);
    setAsk(false);
  }

  function later() {
    try {
      localStorage.setItem(LATER_KEY, "1");
    } catch {
      // Storage blocked: hidden for this visit only.
    }
    setAsk(false);
  }

  return (
    <section className="rounded-card border border-line-subtle bg-surface-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <BellRing size={20} className="shrink-0 text-accent-400" aria-hidden />
        <p className="flex-1 text-sm text-text-secondary">{t("prompt")}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="md" variant="secondary" loading={busy} onPress={() => void enable()}>
          {t("enable")}
        </Button>
        <Button size="md" variant="ghost" onPress={later}>
          {t("later")}
        </Button>
      </div>
    </section>
  );
}
