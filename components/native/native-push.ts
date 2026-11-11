"use client";

/**
 * Native push for the App Store / Play build: the WebView has no web push,
 * so the phone registers an APNs (iOS) or FCM (Android) token with
 * /api/guest/push/native. Same moment and copy as the web prompt
 * (components/guest/push-prompt.tsx).
 */
import { apiFetch } from "@/components/guest/api";
import { nativePlatform } from "./platform";

export type NativePermission = "granted" | "denied" | "prompt";

/** Whether the server can reach this platform (keys configured). */
export async function nativePushAvailable(): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform) return false;
  const res = await apiFetch<{ ios: boolean; android: boolean }>("/api/guest/push/native");
  return res.ok && Boolean(res.data[platform]);
}

export async function nativePushPermission(): Promise<NativePermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

export async function requestNativePush(): Promise<boolean> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.requestPermissions();
  return receive === "granted";
}

/** Registers with APNs/FCM and hands the device token to the server for this event's guest app. */
export async function registerNativePush(qrToken: string): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform) return false;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const deviceToken = await new Promise<string | null>((resolve) => {
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];
    const finish = (value: string | null) => {
      clearTimeout(timer);
      handles.forEach((h) => void h.then((x) => x.remove()));
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 15_000);
    handles.push(PushNotifications.addListener("registration", ({ value }) => finish(value)));
    handles.push(PushNotifications.addListener("registrationError", () => finish(null)));
    void PushNotifications.register().catch(() => finish(null));
  });
  if (!deviceToken) return false;
  const saved = await apiFetch("/api/guest/push/native", {
    method: "POST",
    body: JSON.stringify({ token: qrToken, platform, deviceToken }),
  });
  return saved.ok;
}
