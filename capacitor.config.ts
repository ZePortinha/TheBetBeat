import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell for the App Store and Google Play (docs/APP-LOJAS.md).
 *
 * The app is the live Next.js site loaded in the native WebView
 * (`server.url`), not a static export: pages render on the server
 * (middleware CSP nonce, httpOnly Supabase cookies, server actions, API
 * routes), so there is nothing that could be bundled offline. The Capacitor
 * bridge is injected into that origin only, which is what lets the site
 * call native push, splash and back-button plugins. `native/www` holds the
 * bundled pages the shell shows without network (offline.html).
 *
 * CAP_SERVER_URL picks the site at `pnpm cap:sync` time:
 *   production  https://discontrol.app (default)
 *   phone on LAN http://192.168.x.y:3000 (cleartext allowed only for http)
 */
const serverUrl = new URL(process.env.CAP_SERVER_URL ?? "https://discontrol.app");
const isLanDev = serverUrl.protocol === "http:";

const config: CapacitorConfig = {
  // Reverse-DNS id: final once the first build is uploaded to either store.
  appId: "app.discontrol",
  appName: "Discontrol",
  webDir: "native/www",
  // Lets the server tell the app from a browser tab (never used for trust).
  appendUserAgent: "DiscontrolApp",
  backgroundColor: "#000000",
  server: {
    url: serverUrl.origin,
    cleartext: isLanDev,
    // Shown by the shell when the site cannot be reached.
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: isLanDev,
  },
  plugins: {
    SplashScreen: {
      // The site hides it as soon as it paints (components/native/native-bridge.tsx);
      // the timer is only the fallback when the network is slow.
      launchShowDuration: 4000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#000000",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ["alert", "sound"],
    },
  },
};

export default config;
