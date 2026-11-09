"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { isWinPath } from "@/components/guest/party-paths";

/** Set after the first party screen has mounted: later mounts are navigations. */
let navigated = false;

/**
 * Party screens arrive with a short rise and fade when switching tabs, so
 * the app reads as one continuous surface instead of hard cuts. Not on the
 * first load: the page paints at once (LCP) and the markup matches the
 * server's. CSS only, transform + opacity, under 250 ms.
 *
 * Never around the winner's screen: it is fixed to the screen, and a
 * transform on a parent would make it move with this wrapper instead.
 */
export default function PartyTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [enter] = React.useState(() => navigated && !isWinPath(pathname));
  React.useEffect(() => {
    navigated = true;
  }, []);
  return <div className={enter ? "page-enter" : undefined}>{children}</div>;
}
