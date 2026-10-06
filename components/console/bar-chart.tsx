/**
 * Minimal SVG bar chart (no chart deps — B9 Análise "receita por hora").
 * Server-renderable; values and labels arrive pre-formatted.
 */

export interface Bar {
  label: string;
  value: number;
  /** Pre-formatted value for the tooltip/caption (e.g. "120 €"). */
  display: string;
}

export function BarChart({
  bars,
  title,
  height = 160,
}: {
  bars: Bar[];
  title: string;
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const barWidth = 100 / Math.max(1, bars.length);
  const plotH = height - 24;

  return (
    <figure role="img" aria-label={title} className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-48 w-full"
      >
        {bars.map((bar, i) => {
          const h = (bar.value / max) * (plotH - 8);
          return (
            <rect
              key={bar.label}
              x={i * barWidth + barWidth * 0.15}
              y={plotH - h}
              width={barWidth * 0.7}
              height={Math.max(h, bar.value > 0 ? 1 : 0)}
              rx={1}
              fill="var(--color-accent-500)"
              opacity={0.9}
            >
              <title>{`${bar.label} · ${bar.display}`}</title>
            </rect>
          );
        })}
        <line
          x1="0"
          y1={plotH}
          x2="100"
          y2={plotH}
          stroke="var(--color-line-strong)"
          strokeWidth="0.5"
        />
      </svg>
      <div
        className="grid text-center text-[11px] text-text-tertiary tnum"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, bars.length)}, 1fr)` }}
      >
        {bars.map((bar) => (
          <span key={bar.label}>{bar.label}</span>
        ))}
      </div>
    </figure>
  );
}
