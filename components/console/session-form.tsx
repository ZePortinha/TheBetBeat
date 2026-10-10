"use client";

/**
 * Session create/edit form (B9.1). Inline validation while typing
 * (B10.8): the B5.6 "+5 € per tier" rule is checked live client-side
 * and again server-side — the server is the authority.
 */

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
}

export interface SessionFormProps {
  venueId: string;
  djs: Array<{ id: string; name: string }>;
  genreOptions: string[];
  betbeatFeePct: number;
  initial: SessionFormValues;
}

const inputCls =
  "w-full rounded-button border border-line-subtle bg-surface-3 px-3 py-2 " +
  "text-base text-text-primary focus:border-accent-500 focus:outline-none " +
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
  betbeatFeePct,
  initial,
}: SessionFormProps) {
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
    return e;
  }, [tiers]);

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
        <fieldset>
          <legend className="label pb-2 text-text-secondary">{t("form.genres")}</legend>
          {errorFor("genres") ? (
            <p role="alert" className="pb-2 text-xs text-ember-500">
              {errorFor("genres")}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {genreOptions.map((genre) => (
              <label
                key={genre}
                className="flex items-center gap-2 rounded-button border border-line-subtle
                  bg-surface-2 px-3 py-2 text-sm text-text-primary
                  has-checked:border-accent-500 has-checked:bg-surface-3"
              >
                <input
                  type="checkbox"
                  name="genres"
                  value={genre}
                  defaultChecked={initial.genres.includes(genre)}
                  className="accent-[var(--color-accent-500)]"
                />
                {genre}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-text-primary">{t("form.pricing")}</h2>
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
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-text-primary">{t("form.split")}</h2>
        <p className="text-sm text-text-tertiary">
          {t("form.splitHint", { fee: betbeatFeePct })}
        </p>
        <Field label={t("form.venueShare")} error={errorFor("venueSharePct")}>
          <input
            type="number"
            name="venueSharePct"
            min={0}
            max={100}
            step="1"
            defaultValue={initial.venueSharePct}
            required
            className={`${inputCls} tnum max-w-40`}
          />
        </Field>
      </section>

      {state?.formError ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${state.formError}`)}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || Object.keys(liveErrors).length > 0}
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
