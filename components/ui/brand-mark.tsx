/**
 * The BetBeat mark (same geometry as app/icon.svg and the boot intro):
 * three concentric beats around a dark core. Decorative; pair it with
 * visible or sr-only text where it names the product.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <circle cx="256" cy="256" r="150" fill="none" className="stroke-accent-500" strokeWidth="22" opacity="0.35" />
      <circle cx="256" cy="256" r="104" fill="none" className="stroke-accent-500" strokeWidth="24" opacity="0.7" />
      <circle cx="256" cy="256" r="58" className="fill-accent-500" />
      <circle cx="256" cy="256" r="20" className="fill-bg-raised" />
    </svg>
  );
}
