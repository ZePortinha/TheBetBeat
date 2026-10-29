/**
 * The Discontrol mark with literal colours (mirrors styles/tokens.css), for
 * Satori renders (share cards, Open Graph) where Tailwind classes do not
 * exist. Same geometry as BrandMark.
 */
export function StaticBrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <circle cx="256" cy="256" r="232" fill="#1c1c1e" />
      <circle cx="256" cy="256" r="204" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="5" />
      <circle cx="256" cy="256" r="178" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="5" />
      <circle cx="256" cy="256" r="152" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="5" />
      <circle cx="256" cy="256" r="112" fill="#e8112d" />
      <line x1="256" y1="226" x2="256" y2="164" stroke="#ffffff" strokeWidth="26" strokeLinecap="round" transform="rotate(40 256 256)" />
    </svg>
  );
}
