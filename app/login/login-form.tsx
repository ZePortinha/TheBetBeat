"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

interface Labels {
  email: string;
  password: string;
  submit: string;
  errorInvalid: string;
  errorRateLimited: string;
  errorBot: string;
}

export function LoginForm({ next, labels }: { next: string; labels: Labels }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    null,
  );

  const errorText =
    state?.error === "invalid"
      ? labels.errorInvalid
      : state?.error === "rate_limited"
        ? labels.errorRateLimited
        : state?.error === "bot"
          ? labels.errorBot
          : null;

  const inputCls =
    "w-full rounded-button bg-surface-3 border border-line-subtle px-4 py-3 " +
    "text-base text-text-primary placeholder:text-text-tertiary " +
    "focus:border-gold-500 focus:outline-none";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.email}</span>
        <input
          className={inputCls}
          type="email"
          name="email"
          autoComplete="email"
          required
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label text-text-secondary">{labels.password}</span>
        <input
          className={inputCls}
          type="password"
          name="password"
          autoComplete="current-password"
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
        className="mt-2 min-h-11 rounded-button bg-gold-500 px-4 py-3 text-base
          font-semibold text-text-on-accent transition-transform duration-100
          active:scale-[0.97] disabled:opacity-60"
      >
        {labels.submit}
      </button>
    </form>
  );
}
