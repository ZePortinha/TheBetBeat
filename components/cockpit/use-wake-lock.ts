"use client";

/**
 * Screen Wake Lock (BRIEF B7 "Wake Lock ativo"): acquired on mount and
 * re-acquired whenever the tab becomes visible again (the UA releases
 * the sentinel on hide). Unsupported browsers no-op silently.
 */
import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> } | null;

export function useWakeLock(): void {
  useEffect(() => {
    let sentinel: WakeLockSentinelLike = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const wakeLock = (
          navigator as Navigator & {
            wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
          }
        ).wakeLock;
        if (!wakeLock) return;
        const s = await wakeLock.request("screen");
        if (disposed) {
          await s?.release();
          return;
        }
        sentinel = s;
      } catch {
        // Low battery / permission — the cockpit still works.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
