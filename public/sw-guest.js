/**
 * Guest service worker: web push only ("someone outbid you", "you are the
 * winner"). Scope /s/ (registered by components/guest/push-prompt.tsx).
 * No fetch handler and no caches: the guest app stays network-only.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || !data.title) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // The guest is looking at the app: the screen already says it.
      if (clients.some((c) => c.visibilityState === "visible" && c.focused)) return undefined;
      return self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        renotify: true,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: [80, 40, 80],
        data: { url: data.url || "/" },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => new URL(c.url).pathname.startsWith(url));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
