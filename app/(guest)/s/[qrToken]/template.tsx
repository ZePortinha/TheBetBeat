"use client";

import * as React from "react";

/** Set after the first party screen has mounted: later mounts are navigations. */
let navigated = false;

/**
 * Party screens arrive with a short rise and fade when switching tabs, so
 * the app reads as one continuous surface instead of hard cuts. Not on the
 * first load: the page paints at once (LCP) and the markup matches the
 * server's. CSS only, transform + opacity, under 250 ms.
 */
export default function PartyTemplate({ children }: { children: React.ReactNode }) {
  const [enter] = React.useState(() => navigated);
  React.useEffect(() => {
    navigated = true;
  }, []);
  return <div className={enter ? "page-enter" : undefined}>{children}</div>;
}
