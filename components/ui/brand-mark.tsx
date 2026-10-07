/**
 * BrandMark: the BetBeat record (two grooves and the label, from
 * public/icons/icon.svg) as a component, plus the lockup with the name.
 *
 * The centre hole is drawn as a thick ring (not a black dot), so the mark
 * sits on any surface and the page shows through it. Presentation only:
 * the name arrives via props; colours are tokens.
 */

// Local join: this module stays server-safe (pressable is a client module).
const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/** Geometry of the 512-unit mark, shared with the boot intro. */
export const MARK = {
  // Cropped to the outer groove's edge (256 ± 161) so the mark fills its box.
  viewBox: "95 95 322 322",
  outer: { r: 150, width: 22, opacity: 0.35 },
  inner: { r: 104, width: 24, opacity: 0.7 },
  // The label: a ring from the hole (r 20) to the edge (r 58).
  label: { r: 39, width: 38 },
} as const;

export function BrandMark({
  className,
  title,
}: {
  /** Size with Tailwind (`size-6`); the mark is square. */
  className?: string;
  /** Accessible name; without it the mark is decorative. */
  title?: string;
}) {
  return (
    <svg
      viewBox={MARK.viewBox}
      className={cx("shrink-0 text-accent-500", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="none" stroke="currentColor">
        <circle
          cx="256"
          cy="256"
          r={MARK.outer.r}
          strokeWidth={MARK.outer.width}
          opacity={MARK.outer.opacity}
        />
        <circle
          cx="256"
          cy="256"
          r={MARK.inner.r}
          strokeWidth={MARK.inner.width}
          opacity={MARK.inner.opacity}
        />
        <circle cx="256" cy="256" r={MARK.label.r} strokeWidth={MARK.label.width} />
      </g>
    </svg>
  );
}

/** Mark + name. `size` sets both: the mark tracks the cap height of the name. */
export function BrandLockup({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const look = {
    sm: { mark: "size-[1.0625rem]", text: "text-[0.9375rem]", gap: "gap-1.5" },
    md: { mark: "size-[1.375rem]", text: "text-xl", gap: "gap-2" },
    lg: { mark: "size-8", text: "text-[1.75rem]", gap: "gap-2.5" },
  }[size];
  return (
    <span className={cx("inline-flex items-center", look.gap, className)}>
      <BrandMark className={look.mark} />
      <span
        className={cx(
          "font-semibold leading-none tracking-[-0.02em] text-text-primary",
          look.text,
        )}
      >
        {name}
      </span>
    </span>
  );
}
