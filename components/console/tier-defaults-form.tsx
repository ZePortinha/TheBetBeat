"use client";

/**
 * Venue default tier-limits editor (B9.3). Inline errors (B10.8) —
 * the B5.6 "+5 € per tier" rule is rejected server-side and surfaced
 * next to the offending field.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  saveDefaultsAction,
  type DefaultsFormState,
} from "@/app/(console)/console/precos/actions";

export interface TierDefaultsValues {
  basePriceEur: number;
  queueMinEur: number;
  queueMaxEur: number;
  soonMinEur: number;
  soonMaxEur: number;
  nextMinEur: number;
  nextMaxEur: number;
}

const inputCls =
  "w-full rounded-button border border-line-subtle bg-surface-3 px-3 py-2 " +
  "text-base text-text-primary tnum focus:border-gold-500 focus:outline-none";

export function TierDefaultsForm({
  venueId,
  initial,
}: {
  venueId: string;
  initial: TierDefaultsValues;
}) {
  const t = useTranslations("console.pricing.defaults");
  const te = useTranslations("console.sessions.errors");
  const [state, formAction, pending] = useActionState<DefaultsFormState, FormData>(
    saveDefaultsAction,
    null,
  );

  const error = (field: string) => {
    const key = state?.errors?.[field];
    return key ? te(key) : undefined;
  };

  const field = (name: keyof TierDefaultsValues, label: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="label text-text-secondary">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        step="1"
        defaultValue={initial[name]}
        required
        className={inputCls}
      />
      {error(name) ? (
        <span role="alert" className="text-xs text-ember-500">
          {error(name)}
        </span>
      ) : null}
    </label>
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-5"
    >
      <input type="hidden" name="venueId" value={venueId} />
      <p className="text-sm text-text-tertiary">{t("hint")}</p>
      <div className="grid grid-cols-4 items-start gap-4">
        {field("basePriceEur", t("basePrice"))}
        <div className="flex flex-col gap-2">
          <p className="label text-text-tertiary">{t("queue")}</p>
          {field("queueMinEur", t("min"))}
          {field("queueMaxEur", t("max"))}
        </div>
        <div className="flex flex-col gap-2">
          <p className="label text-text-tertiary">{t("soon")}</p>
          {field("soonMinEur", t("min"))}
          {field("soonMaxEur", t("max"))}
        </div>
        <div className="flex flex-col gap-2">
          <p className="label text-text-tertiary">{t("next")}</p>
          {field("nextMinEur", t("min"))}
          {field("nextMaxEur", t("max"))}
        </div>
      </div>
      {error("form") ? (
        <p role="alert" className="text-sm text-ember-500">
          {error("form")}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-10 self-start rounded-button bg-gold-500 px-5 text-sm
            font-semibold text-text-on-accent transition-transform duration-100
            active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </button>
        {state?.ok ? (
          <p className="text-sm text-green-500">{t("saved")}</p>
        ) : null}
      </div>
    </form>
  );
}
