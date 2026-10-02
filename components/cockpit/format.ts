/**
 * Cockpit display formatting — Europe/Lisbon clock (B11 "Datas"),
 * euro strings via the shared PriceTag formatter.
 */
export { formatEurosDisplay } from "@/components/ui/price-tag";

const lisbonTime = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  hour: "2-digit",
  minute: "2-digit",
});

/** "23:41" in Europe/Lisbon. */
export function formatLisbonTime(epochMs: number): string {
  return lisbonTime.format(new Date(epochMs));
}

/** Minutes between two epochs, floored at 0. */
export function minutesUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.round((targetMs - nowMs) / 60_000));
}
