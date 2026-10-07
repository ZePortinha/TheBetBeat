/**
 * Every party screen arrives the same way: a short rise and fade, so
 * switching tabs reads as one continuous app instead of a hard cut.
 * CSS only (no hydration wait), transform + opacity, under 250 ms.
 */
export default function PartyTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
