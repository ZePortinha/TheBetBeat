"use client";

/**
 * Event create/edit form (B9.1, reworked 2026-10-11): the event, its music
 * (styles + BPM range that steer the guests' first recommendations, and the
 * catalog mode), and the revenue split (Ritmo's flat fee, then club,
 * promoter and DJ, with a live 100 € example). The legacy request-tier
 * prices stay under "Preços dos pedidos diretos". Inline validation while
 * typing (B10.8); the server re-validates and is the authority.
 */

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { computeSplit } from "@/lib/ledger/split";
import {
  saveSessionAction,
  type SessionFormState,
} from "@/app/(console)/console/sessoes/actions";

export interface SessionFormValues {
  sessionId?: string;
  name: string;
  date: string; // yyyy-mm-dd (Lisbon)
  startTime: string; // HH:mm
  endTime: string;
  djStaffId: string;
  genres: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  catalogMode: "library" | "library_plus_catalog";
  basePriceEur: number;
  acceptanceRatePerHour: number;
  soonDeadlineMin: number;
  nextDeadlineMin: number;
  queueMinEur: number;
  queueMaxEur: number;
  soonMinEur: number;
  soonMaxEur: number;
  nextMinEur: number;
  nextMaxEur: number;
  venueSharePct: number;
  promoterName: string;
  promoterSharePct: number;
}

export interface SessionFormProps {
  venueId: string;
  djs: Array<{ id: string; name: string }>;
  genreOptions: string[];
  /** Ritmo's fee on this event (flat 11% for new ones), bps. */
  betbeatFeeBps: number;
  initial: SessionFormValues;
}

const inputCls =
  "w-full rounded-button border border-line-subtle bg-surface-3 px-3 py-2 " +
  "text-base text-text-primary focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/25 " +
  "disabled:opacity-60";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label text-text-secondary">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-ember-500">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SessionForm({
  venueId,
  djs,
  genreOptions,
  betbeatFeeBps,
  initial,
}: SessionFormProps) {
  const betbeatFeePct = betbeatFeeBps / 100;
  const t = useTranslations("console.sessions");
  const [state, formAction, pending] = useActionState<SessionFormState, FormData>(
    saveSessionAction,
    null,
  );

  // Live B5.6 check while typing (server re-validates).
  const [tiers, setTiers] = useState({
    base: initial.basePriceEur,
    qMin: initial.queueMinEur,
    qMax: initial.queueMaxEur,
    sMin: initial.soonMinEur,
    sMax: initial.soonMaxEur,
    nMin: initial.nextMinEur,
    nMax: initial.nextMaxEur,
  });
  // Revenue split + event rules, live.
  const [shares, setShares] = useState({ venue: initial.venueSharePct, promoter: initial.promoterSharePct });
  const [promoterName, setPromoterName] = useState(initial.promoterName);
  const [bpm, setBpm] = useState({ min: initial.bpmMin?.toString() ?? "", max: initial.bpmMax?.toString() ?? "" });
  const styleOptions = useMemo(
    () => [...new Set([...initial.genres, ...genreOptions])],
    [initial.genres, genreOptions],
  );
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.genres));
  const [customStyles, setCustomStyles] = useState("");
  const example = useMemo(() => {
    const v = Math.round(shares.venue * 100);
    const p = Math.round(shares.promoter * 100);
    if (!(v >= 0 && p >= 0 && v + p <= 10_000)) return null;
    return computeSplit(10_000, betbeatFeeBps, v, p);
  }, [shares, betbeatFeeBps]);
  const djPct = Math.max(0, 100 - shares.venue - shares.promoter);

  const liveErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (tiers.qMax < tiers.qMin) e.queueMaxEur = "maxBelowMin";
    if (tiers.sMax < tiers.sMin) e.soonMaxEur = "maxBelowMin";
    if (tiers.nMax < tiers.nMin) e.nextMaxEur = "maxBelowMin";
    if (tiers.sMin < tiers.qMin + 5) e.soonMinEur = "tierStep";
    if (tiers.nMin < tiers.sMin + 5) e.nextMinEur = "tierStep";
    if (tiers.base < tiers.qMin || tiers.base > tiers.qMax) {
      e.basePriceEur = "baseOutsideQueue";
    }
    if (shares.venue + shares.promoter > 100) e.promoterSharePct = "sharesOver";
    if (shares.promoter > 0 && promoterName.trim().length === 0) e.promoterName = "promoterName";
    if (bpm.min && bpm.max && Number(bpm.min) > Number(bpm.max)) e.bpmMax = "bpmRange";
    return e;
  }, [tiers, shares, promoterName, bpm]);
  const noStyle = picked.size === 0 && customStyles.trim().length === 0;
  const euros = (cents: number) =>
    new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);

  const errorFor = (field: string): string | undefined => {
    const key = liveErrors[field] ?? state?.errors?.[field];
    return key ? t(`errors.${key}`) : undefined;
  };

  const num =
    (key: keyof typeof tiers) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setTiers((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }));

  return (
    <form action={formAction} data-testid="session-form" className="flex max-w-3xl flex-col gap-8">
      <input type="hidden" name="venueId" value={venueId} />
      {initial.sessionId ? (
        <input type="hidden" name="sessionId" value={initial.sessionId} />
      ) : null}

      <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-text-primary">{t("form.general")}</h2>
        <Field label={t("form.name")} error={errorFor("name")}>
          <input
            name="name"
            defaultValue={initial.name}
            maxLength={80}
            required
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label={t("form.date")} error={errorFor("date")}>
            <input
              type="date"
              name="date"
              defaultValue={initial.date}
              required
              className={inputCls}
            />
          </Field>
          <Field label={t("form.startTime")} error={errorFor("startTime")}>
            <input
              type="time"
              name="startTime"
              defaultValue={initial.startTime}
              required
              className={inputCls}
            />
          </Field>
          <Field label={t("form.endTime")} error={errorFor("endTime")}>
            <input
              type="time"
              name="endTime"
              defaultValue={initial.endTime}
              required
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("form.dj")} error={errorFor("djStaffId")}>
            <select
              name="djStaffId"
              defaultValue={initial.djStaffId}
              required
              className={inputCls}
            >
              <option value="" disabled>
                {t("form.djPlaceholder")}
              </option>
              {djs.map((dj) => (
                <option key={dj.id} value={dj.id}>
                  {dj.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6" data-testid="event-music">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t("form.music")}</h2>
          <p className="mt-1 text-sm text-text-tertiary">{t("form.musicHint")}</p>
        </div>
        <fieldset>
          <legend className="label pb-2 text-text-secondary">{t("form.genres")}</legend>
          {errorFor("genres") ? (
            <p role="alert" className="pb-2 text-xs text-ember-500">
              {errorFor("genres")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {styleOptions.map((genre) => (
              <label
                key={genre}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-subtle
                  bg-surface-2 px-4 text-sm font-semibold text-text-secondary
                  has-checked:border-accent-500 has-checked:bg-accent-500/15 has-checked:text-text-primary"
              >
                <input
                  type="checkbox"
                  name="genres"
                  value={genre}
                  checked={picked.has(genre)}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(genre);
                      else next.delete(genre);
                      return next;
                    })
                  }
                  className="accent-[var(--color-accent-500)]"
                />
                {genre}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("form.customGenres")}>
          <input
            name="customGenres"
            value={customStyles}
            onChange={(e) => setCustomStyles(e.target.value)}
            maxLength={200}
            placeholder={t("form.customGenresPlaceholder")}
            className={inputCls}
          />
        </Field>
        {noStyle ? <p className="text-sm text-amber-500">{t("form.pickStyle")}</p> : null}
        <div className="grid grid-cols-3 gap-4">
          <Field label={t("form.bpmMin")} error={errorFor("bpmMin")}>
            <input
              type="number"
              name="bpmMin"
              min={40}
              max={220}
              value={bpm.min}
              onChange={(e) => setBpm((b) => ({ ...b, min: e.target.value }))}
              placeholder="—"
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.bpmMax")} error={errorFor("bpmMax")}>
            <input
              type="number"
              name="bpmMax"
              min={40}
              max={220}
              value={bpm.max}
              onChange={(e) => setBpm((b) => ({ ...b, max: e.target.value }))}
              placeholder="—"
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.catalogMode")} error={errorFor("catalogMode")}>
            <select
              name="catalogMode"
              defaultValue={initial.catalogMode}
              className={inputCls}
            >
              <option value="library">{t("form.catalogLibrary")}</option>
              <option value="library_plus_catalog">{t("form.catalogPlus")}</option>
            </select>
          </Field>
        </div>
        <p className="text-sm text-text-tertiary">{t("form.bpmHint")}</p>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6" data-testid="event-split">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-text-primary">{t("form.split")}</h2>
          <span className="tnum rounded-full bg-surface-3 px-3 py-1 text-sm font-semibold text-text-secondary">
            {t("form.feeBadge", { fee: betbeatFeePct })}
          </span>
        </div>
        <p className="text-sm text-text-tertiary">{t("form.splitHint", { fee: betbeatFeePct })}</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label={t("form.venueShare")} error={errorFor("venueSharePct")}>
            <input
              type="number"
              name="venueSharePct"
              min={0}
              max={100}
              step="1"
              value={shares.venue}
              onChange={(e) => setShares((s) => ({ ...s, venue: Number(e.target.value) || 0 }))}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.promoterShare")} error={errorFor("promoterSharePct")}>
            <input
              type="number"
              name="promoterSharePct"
              min={0}
              max={100}
              step="1"
              value={shares.promoter}
              onChange={(e) => setShares((s) => ({ ...s, promoter: Number(e.target.value) || 0 }))}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="label text-text-secondary">{t("form.djShare")}</span>
            <output className="tnum flex min-h-[42px] items-center px-1 text-xl font-semibold text-text-primary" data-testid="dj-share">
              {djPct}%
            </output>
          </div>
        </div>
        <Field label={t("form.promoterName")} error={errorFor("promoterName")}>
          <input
            name="promoterName"
            value={promoterName}
            onChange={(e) => setPromoterName(e.target.value)}
            maxLength={80}
            placeholder={t("form.promoterNamePlaceholder")}
            className={inputCls}
          />
        </Field>
        {example ? (
          <div className="rounded-card border border-line-subtle bg-surface-2 p-4" data-testid="split-example">
            <p className="label text-text-tertiary">{t("form.exampleTitle")}</p>
            <dl className="mt-2 grid grid-cols-4 gap-3">
              {(
                [
                  ["exampleBetbeat", example.betbeatFeeCents],
                  ["exampleVenue", example.venueCents],
                  ["examplePromoter", example.promoterCents],
                  ["exampleDj", example.djCents],
                ] as const
              ).map(([key, cents]) => (
                <div key={key} className="flex flex-col">
                  <dt className="text-xs text-text-tertiary">{t(`form.${key}`)}</dt>
                  <dd className="tnum text-lg font-semibold text-text-primary">{euros(cents)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      <details className="group rounded-card border border-line-subtle bg-surface-1 p-6">
        <summary className="cursor-pointer text-lg font-semibold text-text-primary">{t("form.pricing")}</summary>
        <div className="mt-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("form.basePrice")} error={errorFor("basePriceEur")}>
            <input
              type="number"
              name="basePriceEur"
              min={0}
              step="0.5"
              defaultValue={initial.basePriceEur}
              onChange={num("base")}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.rate")} error={errorFor("acceptanceRatePerHour")}>
            <input
              type="number"
              name="acceptanceRatePerHour"
              min={1}
              max={60}
              defaultValue={initial.acceptanceRatePerHour}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.soonDeadline")} error={errorFor("soonDeadlineMin")}>
            <input
              type="number"
              name="soonDeadlineMin"
              min={5}
              max={120}
              defaultValue={initial.soonDeadlineMin}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
          <Field label={t("form.nextDeadline")} error={errorFor("nextDeadlineMin")}>
            <input
              type="number"
              name="nextDeadlineMin"
              min={3}
              max={60}
              defaultValue={initial.nextDeadlineMin}
              required
              className={`${inputCls} tnum`}
            />
          </Field>
        </div>
        <p className="text-sm text-text-tertiary">{t("form.tierRule")}</p>
        <div className="grid grid-cols-3 gap-4">
          {(
            [
              ["QUEUE", "queueMinEur", "queueMaxEur", "qMin", "qMax"],
              ["SOON", "soonMinEur", "soonMaxEur", "sMin", "sMax"],
              ["NEXT", "nextMinEur", "nextMaxEur", "nMin", "nMax"],
            ] as const
          ).map(([tier, minName, maxName, minKey, maxKey]) => (
            <div
              key={tier}
              className="flex flex-col gap-3 rounded-card border border-line-subtle bg-surface-2 p-4"
            >
              <p className="label text-text-secondary">{t(`tiers.${tier}`)}</p>
              <Field label={t("form.min")} error={errorFor(minName)}>
                <input
                  type="number"
                  name={minName}
                  min={0}
                  step="1"
                  defaultValue={initial[minName]}
                  onChange={num(minKey)}
                  required
                  className={`${inputCls} tnum`}
                />
              </Field>
              <Field label={t("form.max")} error={errorFor(maxName)}>
                <input
                  type="number"
                  name={maxName}
                  min={0}
                  step="1"
                  defaultValue={initial[maxName]}
                  onChange={num(maxKey)}
                  required
                  className={`${inputCls} tnum`}
                />
              </Field>
            </div>
          ))}
        </div>
        </div>
      </details>

      {state?.formError ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${state.formError}`)}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || noStyle || Object.keys(liveErrors).length > 0}
          className="min-h-11 rounded-full bg-accent-500 px-6 text-base font-semibold
            text-text-on-accent transition-transform duration-100 active:scale-[0.97]
            disabled:opacity-60"
        >
          {pending ? t("form.saving") : t("form.save")}
        </button>
      </div>
    </form>
  );
}
