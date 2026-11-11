"use client";

/**
 * Inside the App Store / Play build the Capacitor bridge is injected into
 * the page before any script runs (capacitor.config.ts, server.url). In a
 * browser tab it is absent, so plugin code is only imported when this says
 * so and the web bundle stays the same size.
 */
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

export function nativePlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const platform = cap.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}
