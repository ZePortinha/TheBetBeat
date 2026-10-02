/**
 * EmptyState — a quiet, centered "nothing here yet" block (BRIEF B10.5).
 * Icon (Lucide, stroke 1.75), title, hint and an optional action.
 * All strings arrive via props — UI copy lives in messages/*.json.
 *
 * Server-component friendly: no hooks, no client boundary.
 */

import * as React from "react";
import type { LucideIcon } from "lucide-react";

/** Local class joiner — keeps this module server-component safe. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface EmptyStateProps {
  icon: LucideIcon;
  /** Translated title, e.g. "Ainda não pediste nenhuma música". */
  title: string;
  /** Translated secondary line explaining what to do next (B10.8). */
  hint?: string;
  /** Usually a <Button>, e.g. "Pedir música". */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Icon aria-hidden size={24} strokeWidth={1.75} className="text-text-tertiary" />
      </div>
      <p className="text-base font-semibold text-text-primary">{title}</p>
      {hint && <p className="max-w-xs text-sm text-text-secondary">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
