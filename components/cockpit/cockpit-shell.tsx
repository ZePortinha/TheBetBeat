"use client";

/**
 * Cockpit shell (BRIEF B7): dark, dense, iPad-landscape chrome shared by
 * the four screens — left nav rail (≥56px targets), Wake Lock, service
 * worker registration, the silent-mode gold edge flash (B10.7) and the
 * offline banner (B7 Fiabilidade).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Activity, BarChart3, Settings } from "lucide-react";
import { durations, easeStandard } from "@/lib/motion";
import { BrandMark } from "@/components/ui/brand-mark";
import { cx } from "@/components/ui/pressable";
import { GOLD_FLASH_EVENT } from "./sounds";
import { queuedCount } from "./offline-queue";
import { useWakeLock } from "./use-wake-lock";

function RegisterServiceWorker() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw-cockpit.js", { scope: "/cockpit" })
      .catch(() => undefined);
  }, []);
  return null;
}

/** Two gold border pulses on new-request alerts in silent mode (B10.7). */
function GoldEdgeFlash() {
  const [flashKey, setFlashKey] = React.useState(0);
  React.useEffect(() => {
    const onFlash = () => setFlashKey((k) => k + 1);
    window.addEventListener(GOLD_FLASH_EVENT, onFlash);
    return () => window.removeEventListener(GOLD_FLASH_EVENT, onFlash);
  }, []);
  return (
    <AnimatePresence>
      {flashKey > 0 && (
        <motion.div
          key={flashKey}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[60] rounded-none"
          style={{ boxShadow: "inset 0 0 0 3px var(--color-accent-500), inset 0 0 48px rgba(232, 17, 45,0.25)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.2, 1, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
        />
      )}
    </AnimatePresence>
  );
}

/** "Sem ligação — ações guardadas" (B7). Driven by the browser signal. */
export function OfflineBanner() {
  const t = useTranslations("cockpit");
  const [offline, setOffline] = React.useState(false);
  const [queued, setQueued] = React.useState(0);

  React.useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      setQueued(queuedCount());
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const interval = setInterval(update, 4000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(interval);
    };
  }, []);

  const show = offline || queued > 0;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: durations.fast, ease: easeStandard }}
          className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4"
        >
          <span className="rounded-full border border-amber-500/40 bg-surface-2 px-4 py-2 text-sm font-semibold text-amber-500">
            {t("offline.banner")}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const NAV = [
  { href: "/cockpit", key: "live", Icon: Activity },
  { href: "/cockpit/session", key: "session", Icon: BarChart3 },
  { href: "/cockpit/settings", key: "settings", Icon: Settings },
] as const;

export function CockpitShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("cockpit");
  const pathname = usePathname();
  useWakeLock();

  return (
    <div
      className="flex h-dvh overflow-hidden bg-bg-base text-text-primary"
      style={{ lineHeight: "var(--leading-dense)" }}
    >
      <RegisterServiceWorker />
      <GoldEdgeFlash />
      <OfflineBanner />

      {/* Left nav rail — 56px+ targets, labels under icons (B7/B10.8). */}
      <nav
        aria-label={t("a11y.mainNav")}
        className="flex w-[84px] shrink-0 flex-col items-stretch gap-2 border-r border-line-subtle bg-bg-raised px-2 py-3 print:hidden"
      >
        <BrandMark className="mx-auto mb-2 size-9" />
        {NAV.map(({ href, key, Icon }) => {
          const active =
            href === "/cockpit" ? pathname === "/cockpit" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-button px-1",
                "transition-colors duration-100",
                active
                  ? "bg-surface-2 text-accent-400"
                  : "text-text-secondary active:bg-surface-2",
              )}
            >
              <Icon size={24} strokeWidth={1.75} aria-hidden />
              <span className="text-[length:var(--text-12)] font-semibold leading-none">
                {t(`nav.${key}`)}
              </span>
            </Link>
          );
        })}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
