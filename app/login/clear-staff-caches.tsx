"use client";

import { useEffect } from "react";

/**
 * The cockpit service worker keeps the last good copy of each cockpit screen
 * for Wi-Fi blips (public/sw-cockpit.js). Those pages hold tonight's queue
 * and guest @s, so whenever the sign-in screen shows (after "Sair", or a
 * session that ended) the cached screens are dropped: a shared iPad never
 * shows the previous DJ's cockpit offline. Build assets stay cached.
 */
export function ClearStaffCaches() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    void caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cockpit-") && k.endsWith("-shell")).map((k) => caches.delete(k))))
      .catch(() => undefined);
  }, []);
  return null;
}
