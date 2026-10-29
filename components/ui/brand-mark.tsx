/**
 * The Discontrol mark (same geometry as app/icon.svg and the boot intro):
 * a record whose red label is a mixer knob, its pointer turned up. Disco
 * plus control in one shape. Decorative; pair it with visible or sr-only
 * text where it names the product.
 */

/** Knob pointer angle, clockwise from twelve o'clock. */
export const MARK_POINTER_DEG = 40;

export function MarkGrooves() {
  return (
    <>
      <circle cx="256" cy="256" r="232" className="fill-surface-1" />
      {[204, 178, 152].map((r) => (
        <circle key={r} cx="256" cy="256" r={r} fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="5" />
      ))}
    </>
  );
}

export function MarkKnob() {
  return (
    <>
      <circle cx="256" cy="256" r="112" className="fill-accent-500" />
      <line
        x1="256"
        y1="226"
        x2="256"
        y2="164"
        stroke="#ffffff"
        strokeWidth="26"
        strokeLinecap="round"
        transform={`rotate(${MARK_POINTER_DEG} 256 256)`}
      />
    </>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <MarkGrooves />
      <MarkKnob />
    </svg>
  );
}

/**
 * Mark + name, the lockup used in every header. Size follows the font
 * size of the parent; `name` is shown as text so screen readers read it.
 */
export function Wordmark({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.4em] font-bold tracking-[-0.01em] text-text-primary ${className}`}>
      <BrandMark className="size-[1.25em] shrink-0" />
      <span>{name}</span>
    </span>
  );
}
