"use client";

/**
 * Party guest list: paste numbers (lines or commas), get back how many
 * were added and which entries were not PT mobile numbers.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addGuestListAction,
  type GuestListState,
} from "@/app/(console)/console/sessoes/actions";

export function GuestListForm({ sessionId }: { sessionId: string }) {
  const t = useTranslations("console.sessions.guestList");
  const [state, formAction, pending] = useActionState<GuestListState, FormData>(
    addGuestListAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{t("phonesLabel")}</span>
        {/* React resets the form after the action, so this clears itself. */}
        <textarea
          name="phones"
          rows={3}
          maxLength={20_000}
          data-testid="guest-list-input"
          className="tnum rounded-button border border-line-subtle bg-surface-3 px-3 py-2 text-sm text-text-primary focus:border-accent-500 focus:outline-none"
        />
        <span className="text-xs text-text-tertiary">{t("phonesHint")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-10 rounded-full bg-accent-500 px-5 text-sm font-semibold text-text-on-accent transition-[background-color,transform] duration-100 hover:bg-accent-400 active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? t("adding") : t("add")}
        </button>
        {state?.added !== undefined ? (
          <p role="status" className="text-sm text-green-500">
            {t("added", { count: state.added })}
          </p>
        ) : null}
      </div>
      {state?.invalid && state.invalid.length > 0 ? (
        <p role="alert" className="text-sm text-amber-500">
          {t("invalid", { list: state.invalid.join(", ") })}
        </p>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}
