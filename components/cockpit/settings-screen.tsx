"use client";

/**
 * Definições (BRIEF B7 "Outros ecrãs"):
 *
 * - Rhythm R and base price (±30% inside the venue's limits), the catalog
 *   mode and the no-repeat window — all live, saved through
 *   POST /api/cockpit/session/settings (optimistic + rollback, debounced
 *   per burst of taps; the server clamps and answers with the config).
 * - Genre blocks (POST /api/cockpit/session/genres).
 * - Sounds: volume + silent mode (per-device, localStorage — B10.7).
 * - Library import (multipart → POST /api/cockpit/library/import).
 * - Transfer the session to another DJ of the venue.
 * - "Terminar set": refund preview sheet → HoldButton 2 s (B10.6 #11)
 *   → POST /api/cockpit/session/end → set summary.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRightLeft,
  Ban,
  Check,
  Disc3,
  Minus,
  Plus,
  Power,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";
import { durations, easeStandard, springDefault } from "@/lib/motion";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button, HoldButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cx, Pressable } from "@/components/ui/pressable";
import { PriceTag } from "@/components/ui/price-tag";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatEurosDisplay } from "./format";
import {
  getSilent,
  getVolume,
  playBlip,
  playTierAlert,
  setSilent,
  setVolume,
} from "./sounds";
import { useCockpit } from "./use-cockpit";
import type { CockpitSession, EndSetSummary } from "./types";

const SAVE_DEBOUNCE_MS = 350;
const BASE_PRICE_STEP_CENTS = 50;
const NO_REPEAT_STEP_MIN = 5;

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Card({
  title,
  hint,
  children,
  className,
  testId,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cx(
        "flex flex-col gap-3 rounded-card border border-line-subtle bg-surface-1 p-4",
        className,
      )}
    >
      <header>
        <h2
          className="text-base font-bold text-text-secondary"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-sm text-text-tertiary">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** −/+ stepper with 56 px targets; the value is the loud element. */
function Stepper({
  value,
  display,
  min,
  max,
  step,
  onChange,
  decreaseLabel,
  increaseLabel,
  testId,
}: {
  value: number;
  display: React.ReactNode;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  testId: string;
}) {
  const atMin = value - step < min;
  const atMax = value + step > max;
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="lg"
        aria-label={decreaseLabel}
        disabled={atMin}
        onPress={() => onChange(Math.max(min, value - step))}
        className="w-16 shrink-0 px-0"
        data-testid={`${testId}-decrease`}
      >
        <Minus size={24} strokeWidth={2} aria-hidden />
      </Button>
      <div
        className="tnum flex min-h-14 flex-1 items-center justify-center rounded-button bg-surface-2 px-4 text-center text-[length:var(--text-40)] font-bold text-text-primary"
        role="status"
        aria-live="polite"
        data-testid={`${testId}-value`}
      >
        {display}
      </div>
      <Button
        variant="secondary"
        size="lg"
        aria-label={increaseLabel}
        disabled={atMax}
        onPress={() => onChange(Math.min(max, value + step))}
        className="w-16 shrink-0 px-0"
        data-testid={`${testId}-increase`}
      >
        <Plus size={24} strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}

/** Two-option segmented control (catalog mode). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-button border border-line-subtle bg-surface-2 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={active}
            onPress={() => onChange(option.value)}
            className={cx(
              "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-button px-3 text-base font-semibold",
              "transition-colors duration-100",
              active
                ? "bg-accent-500 text-text-on-accent"
                : "text-text-secondary data-pressed:bg-surface-3",
            )}
          >
            {active ? <Check size={18} strokeWidth={2} aria-hidden /> : null}
            {option.label}
          </Pressable>
        );
      })}
    </div>
  );
}

/** Switch with the same look as the top-bar requests switch. */
function Switch({
  checked,
  onChange,
  label,
  onText,
  offText,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  onText: string;
  offText: string;
  testId?: string;
}) {
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onPress={() => onChange(!checked)}
      data-testid={testId}
      className={cx(
        "flex min-h-14 items-center gap-3 rounded-button border px-3",
        checked
          ? "border-accent-500/40 bg-accent-500/10"
          : "border-line-subtle bg-surface-2",
      )}
    >
      <span
        className={cx(
          "relative block h-8 w-14 shrink-0 rounded-full transition-colors duration-100",
          checked ? "bg-accent-500/35" : "bg-surface-3",
        )}
        aria-hidden
      >
        <motion.span
          className={cx(
            "absolute top-1 block size-6 rounded-full",
            checked ? "bg-accent-500" : "bg-text-tertiary",
          )}
          animate={{ x: checked ? 26 : 4 }}
          transition={springDefault}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-base font-semibold text-text-primary">{label}</span>
        <span className="text-sm text-text-tertiary">{checked ? onText : offText}</span>
      </span>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Set summary (after "Terminar set")                                  */
/* ------------------------------------------------------------------ */

function SetSummary({
  summary,
  onBack,
}: {
  summary: EndSetSummary;
  onBack: () => void;
}) {
  const t = useTranslations("cockpit.summary");
  const rows = [
    ["gmv", summary.statement.gmv],
    ["refunds", summary.statement.refunds],
    ["betbeatFee", summary.statement.betbeatFee],
    ["venueNet", summary.statement.venueNet],
    ["djNet", summary.statement.djNet],
  ] as const;
  return (
    <motion.div
      key="summary"
      data-testid="end-set-summary"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.base, ease: easeStandard }}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <h1
        className="text-xl font-bold tracking-[-0.01em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("title")}
      </h1>
      <p className="text-base text-text-secondary">{t("ended")}</p>
      <p className="tnum text-sm text-text-tertiary">
        {t("closedRequests", { count: summary.closedRequests })}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {rows.map(([key, cents]) => (
          <div
            key={key}
            className={cx(
              "rounded-card border border-line-subtle bg-surface-1 p-4",
              key === "djNet" && "border-accent-500/40",
            )}
          >
            <p className="label text-text-tertiary">{t(key)}</p>
            <PriceTag cents={cents} size="lg" className="mt-2" />
          </div>
        ))}
      </div>
      <div>
        <Button variant="secondary" size="lg" onPress={onBack}>
          {t("backToSettings")}
        </Button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

interface Draft {
  acceptanceRatePerHour: number;
  basePriceCents: number;
  noRepeatWindowMin: number;
  catalogMode: CockpitSession["catalogMode"];
}

type SettingsPatch = Partial<Draft>;

function draftOf(session: CockpitSession): Draft {
  return {
    acceptanceRatePerHour: Math.round(session.config.acceptanceRatePerHour),
    basePriceCents: session.config.basePriceCents,
    noRepeatWindowMin: session.config.noRepeatWindowMin,
    catalogMode: session.catalogMode,
  };
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error body — the status is enough.
  }
  return { ok: res.ok, status: res.status, data };
}

export function SettingsScreen({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations("cockpit.settings");
  const tSession = useTranslations("cockpit.session");
  const { toast } = useToast();
  const cockpit = useCockpit(sessionId);
  const { state, loading, refetch } = cockpit;
  const session = state?.session ?? null;

  /* --- live knobs: draft + debounced save ------------------------- */
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved">("idle");
  const pendingRef = React.useRef<SettingsPatch>({});
  /** True while a save request is out — the server's answer wins then. */
  const inFlightRef = React.useRef(false);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = React.useRef<CockpitSession | null>(null);
  sessionRef.current = session;

  React.useEffect(() => {
    // Adopt the server's values when they change, keeping taps that are
    // still pending on top. Only `session` drives this: re-running it on a
    // status flip used to copy the STALE session back over a value the
    // server had just confirmed (the refetch had not landed yet), which
    // made every change look like it snapped back to the old price.
    if (!session || inFlightRef.current) return;
    setDraft({ ...draftOf(session), ...pendingRef.current });
  }, [session]);

  React.useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const flushSave = React.useCallback(() => {
    const current = sessionRef.current;
    const patch = pendingRef.current;
    pendingRef.current = {};
    saveTimer.current = null;
    if (!current || Object.keys(patch).length === 0) return;
    setSaveStatus("saving");
    inFlightRef.current = true;
    void postJson("/api/cockpit/session/settings", { sessionId: current.id, ...patch }).then(
      (res) => {
        inFlightRef.current = false;
        if (res.ok) {
          const config = (res.data as { config?: Partial<Draft> } | null)?.config;
          if (config) {
            // Server-confirmed (clamped) values win over what we sent, but
            // taps made DURING the save are newer still: keep those.
            setDraft((prev) =>
              prev
                ? {
                    ...prev,
                    acceptanceRatePerHour: Math.round(
                      config.acceptanceRatePerHour ?? prev.acceptanceRatePerHour,
                    ),
                    basePriceCents: config.basePriceCents ?? prev.basePriceCents,
                    noRepeatWindowMin: config.noRepeatWindowMin ?? prev.noRepeatWindowMin,
                    ...pendingRef.current,
                  }
                : prev,
            );
          }
          setSaveStatus("saved");
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
          refetch();
        } else {
          setSaveStatus("idle");
          if (sessionRef.current) {
            setDraft({ ...draftOf(sessionRef.current), ...pendingRef.current });
          }
          toast({ title: t("saveFailed"), variant: "error" });
        }
      },
    );
  }, [refetch, t, toast]);

  const commit = React.useCallback(
    (patch: SettingsPatch) => {
      setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
      pendingRef.current = { ...pendingRef.current, ...patch };
      // Debounce only coalesces a burst of taps — the UI moved already.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  /* --- genre blocks ------------------------------------------------ */
  const [genreOverrides, setGenreOverrides] = React.useState<Record<string, boolean>>({});
  const toggleGenre = React.useCallback(
    (genre: string, blocked: boolean) => {
      if (!session) return;
      setGenreOverrides((prev) => ({ ...prev, [genre]: blocked }));
      void postJson("/api/cockpit/session/genres", { sessionId: session.id, genre, blocked }).then(
        (res) => {
          setGenreOverrides((prev) => {
            const next = { ...prev };
            delete next[genre];
            return next;
          });
          if (!res.ok) toast({ title: t("saveFailed"), variant: "error" });
          refetch();
        },
      );
    },
    [refetch, session, t, toast],
  );

  /* --- sounds (per device) ----------------------------------------- */
  const [volume, setVolumeState] = React.useState(0.8);
  const [silent, setSilentState] = React.useState(false);
  React.useEffect(() => {
    setVolumeState(getVolume());
    setSilentState(getSilent());
  }, []);

  /* --- library import ---------------------------------------------- */
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importState, setImportState] = React.useState<
    | { kind: "idle" }
    | { kind: "importing" }
    | { kind: "done"; imported: number; skipped: number }
    | { kind: "failed" }
  >({ kind: "idle" });

  const onFileChosen = React.useCallback(
    async (file: File | null) => {
      if (!file || !session) return;
      setImportState({ kind: "importing" });
      const form = new FormData();
      form.set("sessionId", session.id);
      form.set("file", file);
      try {
        const res = await fetch("/api/cockpit/library/import", { method: "POST", body: form });
        if (!res.ok) throw new Error(`import ${res.status}`);
        const data = (await res.json()) as { imported: number; skipped: number };
        setImportState({ kind: "done", imported: data.imported, skipped: data.skipped });
        refetch();
      } catch {
        setImportState({ kind: "failed" });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [refetch, session],
  );

  /* --- transfer ---------------------------------------------------- */
  const [transferring, setTransferring] = React.useState<string | null>(null);
  const transferTo = React.useCallback(
    (staffId: string, name: string) => {
      if (!session) return;
      setTransferring(staffId);
      void postJson("/api/cockpit/session/transfer", { sessionId: session.id, staffId }).then(
        (res) => {
          setTransferring(null);
          if (res.ok) {
            toast({ title: t("transfer.done", { name }), variant: "success" });
            refetch();
          } else {
            toast({ title: t("transfer.failed"), variant: "error" });
          }
        },
      );
    },
    [refetch, session, t, toast],
  );

  /* --- end set ----------------------------------------------------- */
  const [endOpen, setEndOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{ count: number; refundCents: number } | null>(
    null,
  );
  const [ending, setEnding] = React.useState(false);
  const [summary, setSummary] = React.useState<EndSetSummary | null>(null);

  React.useEffect(() => {
    if (!endOpen || !session) return;
    let cancelled = false;
    setPreview(null);
    fetch(`/api/cockpit/session/end-preview?sessionId=${encodeURIComponent(session.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`preview ${res.status}`);
        const data = (await res.json()) as { count: number; refundCents: number };
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview({ count: 0, refundCents: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [endOpen, session]);

  const confirmEnd = React.useCallback(() => {
    if (!session || ending) return;
    setEnding(true);
    void postJson("/api/cockpit/session/end", { sessionId: session.id }).then((res) => {
      setEnding(false);
      if (!res.ok) {
        toast({ title: t("endSet.failed"), variant: "error" });
        return;
      }
      const data = res.data as EndSetSummary;
      playBlip();
      setEndOpen(false);
      setSummary(data);
      toast({ title: t("endSet.ended"), variant: "success" });
    });
  }, [ending, session, t, toast]);

  /* --- render ------------------------------------------------------ */

  if (summary) {
    return (
      <AnimatePresence mode="wait">
        <SetSummary
          summary={summary}
          onBack={() => {
            setSummary(null);
            refetch();
          }}
        />
      </AnimatePresence>
    );
  }

  if (loading && !state) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Skeleton height={48} rounded="card" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton height={140} rounded="card" />
          <Skeleton height={140} rounded="card" />
          <Skeleton height={140} rounded="card" />
          <Skeleton height={140} rounded="card" />
        </div>
      </div>
    );
  }

  if (!session || !draft) {
    return (
      <EmptyState
        icon={Disc3}
        title={tSession("none")}
        hint={tSession("noneHint")}
        className="flex-1"
      />
    );
  }

  const bounds = session.basePriceBounds;
  const genres = (state?.genres ?? []).map((g) => ({
    genre: g.genre,
    blocked: genreOverrides[g.genre] ?? g.blocked,
  }));
  const otherDjs = (state?.venueDjs ?? []).filter((d) => d.staffId !== session.djStaffId);

  return (
    <div
      data-testid="settings-screen"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h1
          className="text-xl font-bold tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
        </h1>
        <AnimatePresence initial={false}>
          {saveStatus !== "idle" ? (
            <motion.span
              key={saveStatus}
              role="status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: durations.fast, ease: easeStandard }}
              className={cx(
                "flex items-center gap-1.5 text-sm font-semibold",
                saveStatus === "saved" ? "text-green-500" : "text-text-tertiary",
              )}
            >
              {saveStatus === "saved" ? <Check size={16} strokeWidth={2} aria-hidden /> : null}
              {saveStatus === "saved" ? t("saved") : t("saving")}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* ── Pricing column ─────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <Card title={t("rhythm.title")} hint={t("rhythm.hint")} testId="settings-rhythm">
            <Stepper
              value={draft.acceptanceRatePerHour}
              display={t("rhythm.unit", { value: draft.acceptanceRatePerHour })}
              min={1}
              max={60}
              step={1}
              onChange={(next) => commit({ acceptanceRatePerHour: next })}
              decreaseLabel={t("rhythm.decrease")}
              increaseLabel={t("rhythm.increase")}
              testId="settings-rhythm"
            />
          </Card>

          <Card title={t("basePrice.title")} hint={t("basePrice.hint")} testId="settings-base-price">
            <Stepper
              value={draft.basePriceCents}
              display={formatEurosDisplay(draft.basePriceCents)}
              min={bounds.minCents}
              max={bounds.maxCents}
              step={BASE_PRICE_STEP_CENTS}
              onChange={(next) => commit({ basePriceCents: next })}
              decreaseLabel={t("basePrice.decrease")}
              increaseLabel={t("basePrice.increase")}
              testId="settings-base-price"
            />
            <p className="tnum text-sm text-text-tertiary">
              {t("basePrice.bounds", {
                min: formatEurosDisplay(bounds.minCents),
                max: formatEurosDisplay(bounds.maxCents),
              })}
            </p>
          </Card>

          <Card title={t("catalog.title")} hint={t("catalog.hint")}>
            <Segmented
              value={draft.catalogMode}
              label={t("catalog.title")}
              options={[
                { value: "library", label: t("catalog.library") },
                { value: "library_plus_catalog", label: t("catalog.libraryPlus") },
              ]}
              onChange={(catalogMode) => commit({ catalogMode })}
            />
          </Card>

          <Card title={t("noRepeat.title")} hint={t("noRepeat.hint")}>
            <Stepper
              value={draft.noRepeatWindowMin}
              display={t("noRepeat.unit", { value: draft.noRepeatWindowMin })}
              min={0}
              max={240}
              step={NO_REPEAT_STEP_MIN}
              onChange={(next) => commit({ noRepeatWindowMin: next })}
              decreaseLabel={t("noRepeat.decrease")}
              increaseLabel={t("noRepeat.increase")}
              testId="settings-no-repeat"
            />
          </Card>

          <Card title={t("genres.title")} hint={t("genres.hint")} testId="settings-genres">
            {genres.length === 0 ? (
              <p className="text-sm text-text-tertiary">{t("genres.none")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {genres.map(({ genre, blocked }) => (
                  <Pressable
                    key={genre}
                    aria-pressed={blocked}
                    aria-label={t("genres.title") + ": " + genre}
                    onPress={() => toggleGenre(genre, !blocked)}
                    data-genre={genre}
                    data-blocked={blocked || undefined}
                    className={cx(
                      "flex min-h-12 items-center gap-2 rounded-chip border px-4 text-base font-semibold",
                      "transition-colors duration-100",
                      blocked
                        ? "border-ember-500/50 bg-ember-500/15 text-ember-500 line-through"
                        : "border-line-subtle bg-surface-2 text-text-primary data-pressed:bg-surface-3",
                    )}
                  >
                    {blocked ? <Ban size={16} strokeWidth={2} aria-hidden /> : null}
                    {genre}
                  </Pressable>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Device + session column ────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <Card title={t("sounds.title")} hint={t("sounds.hint")} testId="settings-sounds">
            <label className="flex min-h-14 items-center gap-3">
              {silent || volume === 0 ? (
                <VolumeX size={24} strokeWidth={1.75} aria-hidden className="text-text-tertiary" />
              ) : (
                <Volume2 size={24} strokeWidth={1.75} aria-hidden className="text-text-secondary" />
              )}
              <span className="sr-only">{t("sounds.volume")}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                disabled={silent}
                aria-label={t("sounds.volume")}
                onChange={(event) => {
                  const next = Number(event.target.value) / 100;
                  setVolumeState(next);
                  setVolume(next);
                }}
                onPointerUp={() => playBlip()}
                className="h-14 min-w-0 flex-1 cursor-pointer disabled:opacity-40"
                style={{ accentColor: "var(--color-accent-500)" }}
              />
              <span className="tnum w-12 text-right text-base font-semibold text-text-secondary">
                {Math.round(volume * 100)}%
              </span>
            </label>
            <Switch
              checked={silent}
              onChange={(next) => {
                setSilentState(next);
                setSilent(next);
              }}
              label={t("sounds.silent")}
              onText={t("sounds.silentHint")}
              offText={t("sounds.silentOff")}
              testId="settings-silent"
            />
            <Button
              variant="secondary"
              size="lg"
              onPress={() => playTierAlert("SOON")}
            >
              <Volume2 size={20} strokeWidth={1.75} aria-hidden />
              {t("sounds.test")}
            </Button>
          </Card>

          <Card title={t("library.title")} hint={t("library.hint")} testId="settings-library">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.csv,text/xml,application/xml,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => void onFileChosen(event.target.files?.[0] ?? null)}
            />
            <Button
              variant="secondary"
              size="lg"
              loading={importState.kind === "importing"}
              onPress={() => fileInputRef.current?.click()}
            >
              <Upload size={20} strokeWidth={1.75} aria-hidden />
              {importState.kind === "importing" ? t("library.importing") : t("library.choose")}
            </Button>
            {importState.kind === "done" ? (
              <p role="status" className="tnum text-sm font-semibold text-green-500">
                {t("library.done", {
                  count: importState.imported,
                  skipped: importState.skipped,
                })}
              </p>
            ) : importState.kind === "failed" ? (
              <p role="alert" className="text-sm font-semibold text-ember-500">
                {t("library.failed")}
              </p>
            ) : null}
          </Card>

          <Card title={t("transfer.title")} hint={t("transfer.hint")} testId="settings-transfer">
            {otherDjs.length === 0 ? (
              <p className="text-sm text-text-tertiary">{t("transfer.none")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {otherDjs.map((dj) => (
                  <Button
                    key={dj.staffId}
                    variant="secondary"
                    size="lg"
                    fullWidth
                    loading={transferring === dj.staffId}
                    disabled={transferring !== null && transferring !== dj.staffId}
                    onPress={() => transferTo(dj.staffId, dj.name)}
                  >
                    <ArrowRightLeft size={20} strokeWidth={1.75} aria-hidden />
                    {t("transfer.action", { name: dj.name })}
                  </Button>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={t("endSet.title")}
            hint={t("endSet.hint")}
            className="border-ember-500/30"
            testId="settings-end-set"
          >
            <Button
              variant="destructive"
              size="lg"
              fullWidth
              onPress={() => setEndOpen(true)}
              data-testid="end-set-open"
            >
              <Power size={20} strokeWidth={2} aria-hidden />
              {t("endSet.open")}
            </Button>
          </Card>
        </div>
      </div>

      {/* ── Terminar set: preview + hold-to-confirm (B7) ─────────── */}
      <BottomSheet
        open={endOpen}
        onOpenChange={(open) => {
          if (!open && !ending) setEndOpen(false);
        }}
        title={t("endSet.sheetTitle")}
        description={t("endSet.hint")}
        dismissible={!ending}
      >
        <div className="flex flex-col gap-4 pb-2 pt-1" data-testid="end-set-sheet">
          {preview === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={24} rounded="chip" />
              <p className="text-sm text-text-tertiary">{t("endSet.loading")}</p>
            </div>
          ) : (
            <p
              className="tnum text-xl font-bold text-text-primary"
              role="status"
              data-testid="end-set-preview"
            >
              {preview.count === 0
                ? t("endSet.summaryNone")
                : t("endSet.summary", {
                    count: preview.count,
                    amount: formatEurosDisplay(preview.refundCents),
                  })}
            </p>
          )}
          <div data-testid="end-set-hold" className="flex">
            <HoldButton
              holdMs={2000}
              fullWidth
              disabled={preview === null || ending}
              onConfirm={confirmEnd}
              aria-label={t("endSet.hold")}
            >
              {ending ? t("endSet.loading") : t("endSet.hold")}
            </HoldButton>
          </div>
          <p className="text-center text-sm text-text-tertiary">{t("endSet.holdHint")}</p>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            disabled={ending}
            onPress={() => setEndOpen(false)}
          >
            {t("endSet.cancel")}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
