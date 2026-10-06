"use client";

/**
 * Staff invite form (B9.4). The temp password appears exactly once in
 * the success panel — it is never persisted or shown again.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import {
  inviteStaffAction,
  type InviteState,
} from "@/app/(console)/console/equipa/actions";
import { CopyButton } from "@/components/console/copy-button";

const inputCls =
  "rounded-button border border-line-subtle bg-surface-3 px-3 py-2 text-sm " +
  "text-text-primary focus:border-accent-500 focus:outline-none";

export function InviteForm({ venueId }: { venueId: string }) {
  const t = useTranslations("console.team");
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteStaffAction,
    null,
  );

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-subtle bg-surface-1 p-5">
      <h2 className="text-lg font-semibold text-text-primary">{t("inviteTitle")}</h2>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="venueId" value={venueId} />
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("name")}</span>
          <input name="displayName" required maxLength={60} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("email")}</span>
          <input type="email" name="email" required maxLength={200} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-text-secondary">{t("role")}</span>
          <select name="role" defaultValue="dj" className={inputCls}>
            <option value="dj">{t("roles.dj")}</option>
            <option value="manager">{t("roles.manager")}</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-10 rounded-button bg-accent-500 px-4 text-sm font-semibold
            text-text-on-accent transition-transform duration-100 active:scale-[0.97]
            disabled:opacity-60"
        >
          {pending ? t("inviting") : t("invite")}
        </button>
      </form>

      {state?.error ? (
        <p role="alert" className="text-sm text-ember-500">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}

      {state?.ok && state.tempPassword ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-card border border-accent-500/40 bg-surface-2 p-4"
        >
          <KeyRound aria-hidden size={20} strokeWidth={1.75} className="text-accent-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">
              {t("tempPasswordTitle", { email: state.email ?? "" })}
            </p>
            <p className="text-xs text-text-tertiary">{t("tempPasswordHint")}</p>
          </div>
          <code className="rounded-chip bg-surface-3 px-3 py-1.5 text-base font-semibold text-accent-400 tnum">
            {state.tempPassword}
          </code>
          <CopyButton
            value={state.tempPassword}
            label={t("copy")}
            copiedLabel={t("copied")}
          />
        </div>
      ) : null}
    </div>
  );
}
