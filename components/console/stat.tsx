/**
 * Console stat tile — money/number aggregates (B9 Receita / Análise).
 * Gold is reserved for money per B10.2. A missing value ("—") stays
 * quiet: tertiary, never in the money color.
 */

export function Stat({
  label,
  value,
  hint,
  money = false,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  money?: boolean;
  /** Stable E2E hook for the tile (the value element gets `${testId}-value`). */
  testId?: string;
}) {
  const empty = value === "—";
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-card border border-line-subtle bg-surface-1 p-5"
    >
      <p className="label text-text-tertiary">{label}</p>
      <p
        data-testid={testId ? `${testId}-value` : undefined}
        className={`font-display text-[length:var(--text-24)] font-bold tnum ${
          empty ? "text-text-tertiary" : money ? "text-accent-400" : "text-text-primary"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}
