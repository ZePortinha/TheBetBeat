"use client";

/**
 * DEV panel (BRIEF B4.3 "painel de desenvolvimento") — development only.
 * Lists the guest's pending payments and simulates PSP outcomes by
 * POSTing /api/dev/psp, which drives the REAL signed-webhook path. The
 * API route 404s in production; this component also renders nothing.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { toast } from "@/components/ui/toast";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch } from "./api";
import type { DevPaymentDto } from "./types";

const IS_DEV = process.env.NODE_ENV !== "production";

type DevAction = "confirm" | "decline" | "expire" | "duplicate" | "network_fail";

const ACTIONS: Array<{ action: DevAction; key: string }> = [
  { action: "confirm", key: "confirm" },
  { action: "decline", key: "decline" },
  { action: "expire", key: "expire" },
  { action: "duplicate", key: "duplicate" },
  { action: "network_fail", key: "networkFail" },
];

function usePayments(enabled: boolean) {
  const [payments, setPayments] = React.useState<DevPaymentDto[]>([]);
  const refresh = React.useCallback(async () => {
    const res = await apiFetch<{ payments: DevPaymentDto[] }>("/api/dev/psp");
    if (res.ok) setPayments(res.data.payments);
  }, []);
  React.useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [enabled, refresh]);
  return { payments, refresh };
}

async function runAction(paymentId: string, action: DevAction, doneLabel: string) {
  const res = await apiFetch<{ action: string }>("/api/dev/psp", {
    method: "POST",
    body: JSON.stringify({ paymentId, action }),
  });
  if (res.ok) toast({ title: doneLabel, variant: "default", durationMs: 2000 });
  else toast({ title: `dev: ${res.code}`, variant: "error", durationMs: 3000 });
}

function ActionButtons({ payment }: { payment: DevPaymentDto }) {
  const t = useTranslations("guest.dev");
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map(({ action, key }) => (
        <Pressable
          key={action}
          onPress={() =>
            void runAction(payment.paymentId, action, t("done", { action: t(key) }))
          }
          className="rounded-chip border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs font-semibold text-text-primary"
        >
          {t(key)}
        </Pressable>
      ))}
    </div>
  );
}

/** Compact action row used inside the MB WAY waiting phase. */
export function DevPanelInline() {
  const t = useTranslations("guest.dev");
  const { payments } = usePayments(IS_DEV);
  if (!IS_DEV) return null;
  const pending = payments.find((p) => p.status === "pending");
  if (!pending) return null;
  return (
    <div className="w-full rounded-card border border-dashed border-line-strong bg-bg-raised px-3 py-3 text-left">
      <p className="label mb-2 text-text-tertiary">{t("title")}</p>
      <ActionButtons payment={pending} />
    </div>
  );
}

/** Floating DEV button + sheet (payment / tracking screens). */
export function DevPanel() {
  const t = useTranslations("guest.dev");
  const [open, setOpen] = React.useState(false);
  const { payments } = usePayments(IS_DEV && open);
  if (!IS_DEV) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        aria-label={t("title")}
        className="fixed bottom-24 right-4 z-40 flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-3 py-2 text-xs font-bold text-text-secondary shadow-lg"
      >
        <FlaskConical size={14} strokeWidth={1.75} aria-hidden />
        {t("open")}
      </Pressable>
      <BottomSheet open={open} onOpenChange={setOpen} title={t("title")}>
        <div className="flex flex-col gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2">
          {payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-tertiary">{t("empty")}</p>
          ) : (
            payments.map((p) => (
              <div
                key={p.paymentId}
                className="rounded-card border border-line-subtle bg-surface-1 px-3 py-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
                    {p.trackTitle}
                  </span>
                  <span className="tnum shrink-0 text-xs text-text-tertiary">
                    {p.method} · {p.status} · {formatEurosDisplay(p.amountCents)}
                  </span>
                </div>
                {p.status === "pending" ? (
                  <ActionButtons payment={p} />
                ) : null}
              </div>
            ))
          )}
          <Button variant="secondary" fullWidth onPress={() => setOpen(false)}>
            OK
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
