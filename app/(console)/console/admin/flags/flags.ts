/**
 * Feature-flag allowlist for `venues.settings` (B9 admin "Feature flags").
 *
 * Only these keys are ever written by the flags editor; everything else
 * in the jsonb (sessionDefaults, …) is owned by other console pages and
 * is left untouched. Shared by the page (render) and the action (zod).
 */

export type FlagKind = "boolean" | "integer";

export interface FlagDef {
  key: string;
  kind: FlagKind;
  min?: number;
  max?: number;
}

export const FLAGS: readonly FlagDef[] = [
  { key: "guestMessagesEnabled", kind: "boolean" },
  { key: "catalogFallbackEnabled", kind: "boolean" },
  { key: "invoicesEnabled", kind: "boolean" },
  { key: "smsNotificationsEnabled", kind: "boolean" },
  { key: "displayTopEnabled", kind: "boolean" },
  { key: "basePriceCents", kind: "integer", min: 100, max: 100_000 },
  { key: "occupancy", kind: "integer", min: 1, max: 100_000 },
  { key: "defaultVenueShareBps", kind: "integer", min: 0, max: 10_000 },
] as const;

export const FLAG_KEYS = FLAGS.map((f) => f.key);

/** Form encoding for a boolean flag: inherit (unset) / on / off. */
export const BOOLEAN_CHOICES = ["inherit", "on", "off"] as const;
