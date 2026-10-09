"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "./actions";

interface Labels {
  password: string;
  confirm: string;
  submit: string;
  errorShort: string;
  errorMismatch: string;
  errorSame: string;
  errorFailed: string;
}

export function PasswordForm({ next, minLength, labels }: { next: string; minLength: number; labels: Labels }) {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(changePasswordAction, null);

  const errorText =
    state?.error === "short"
      ? labels.errorShort
      : state?.error === "mismatch"
        ? labels.errorMismatch
        : state?.error === "same"
          ? labels.errorSame
          : state?.error === "failed"
            ? labels.errorFailed
            : null;

  const inputCls =
    "min-h-12 w-full rounded-button bg-surface-2 border border-line-strong px-4 py-3 " +
    "text-base text-text-primary placeholder:text-text-tertiary " +
    "transition-[border-color,box-shadow] duration-100 " +
    "focus:border-accent-400 focus:outline-none focus:ring-4 focus:ring-accent-500/25";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.password}</span>
        <input
          className={inputCls}
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.confirm}</span>
        <input
          className={inputCls}
          type="password"
          name="confirm"
          autoComplete="new-password"
          minLength={minLength}
          required
        />
      </label>
      {errorText ? (
        <p role="alert" className="text-sm text-ember-500">
          {errorText}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-12 rounded-full bg-accent-500 px-4 py-3 text-base
          font-semibold text-text-on-accent transition-[background-color,transform] duration-100
          hover:bg-accent-400 active:scale-[0.97] active:bg-accent-700 disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}
