"use client";

/**
 * Glue between the site and the App Store / Play shell. Renders nothing and
 * does nothing in a browser tab. In the app it:
 * - hides the launch splash once the first page has painted;
 * - keeps the status bar light-on-black;
 * - maps Android's back button to history (or leaves the app at the root);
 * - opens guest links that reach the app (scanned QR universal links, push taps)
 *   in place. Only /s/<token> paths are followed, like the QR scanner.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { guestPathFrom } from "@/lib/guest-path";
import { isNativeApp } from "./platform";

export function NativeBridge() {
  const router = useRouter();

  React.useEffect(() => {
    if (!isNativeApp()) return;
    let disposed = false;
    const removers: Array<() => Promise<void>> = [];
    const open = (url: unknown) => {
      if (typeof url !== "string") return;
      const path = guestPathFrom(url);
      if (path) router.push(path);
    };

    void (async () => {
      const [{ SplashScreen }, { StatusBar, Style }, { App }, { PushNotifications }] = await Promise.all([
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
        import("@capacitor/app"),
        import("@capacitor/push-notifications"),
      ]);
      if (disposed) return;
      void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => undefined);
      void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
      const handles = await Promise.all([
        App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.minimizeApp();
        }),
        App.addListener("appUrlOpen", ({ url }) => open(url)),
        PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) =>
          open((notification.data as { url?: unknown } | undefined)?.url),
        ),
      ]);
      handles.forEach((h) => removers.push(() => h.remove()));
      if (disposed) removers.forEach((remove) => void remove());
    })().catch(() => undefined);

    return () => {
      disposed = true;
      removers.forEach((remove) => void remove());
    };
  }, [router]);

  return null;
}
