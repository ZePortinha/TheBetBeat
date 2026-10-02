/**
 * Console stat tile — money/number aggregates (B9 Receita / Análise).
 * Gold is reserved for money per B10.2.
 */

export function Stat({
  label,
  value,
  hint,
  money = false,
}: {
  label: string;
  value: string;
  hint?: string;
  money?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line-subtle bg-surface-1 p-5">
      <p className="label text-text-tertiary">{label}</p>
      <p
        className={`font-display text-[length:var(--text-24)] font-bold tnum ${
          money ? "text-gold-500" : "text-text-primary"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}
