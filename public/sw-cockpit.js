/**
 * Cockpit service worker (BRIEF B7 "Fiabilidade" + B11 PWA).
 *
 * Scope: /cockpit (registered by components/cockpit/cockpit-shell.tsx).
 *
 * What it does — and deliberately does NOT do:
 *  - App shell: /cockpit navigations are network-first with a cached
 *    fallback, so a Wi-Fi blip in the booth never leaves the DJ on a
 *    browser error page. The last good copy of each screen is kept.
 *  - Hashed build assets (/_next/static) are cache-first (immutable).
 *  - Icons + manifest are stale-while-revalidate.
 *  - /api/** is NEVER cached or replayed here. The server is the source
 *    of truth; offline cockpit ACTIONS live in the page's localStorage
 *    queue (components/cockpit/offline-queue.ts) and replay in order on
 *    reconnect with their idempotency keys. A SW replaying money-relevant
 *    POSTs out of band would break that ordering guarantee.
 *  - No push, no background sync, no precache list: nothing to go stale.
 */

const VERSION = "cockpit-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];

const COCKPIT_SHELL = "/cockpit";

self.addEventListener("install", (event) => {
  // Warm the shell best-effort; failure must not block installation.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        fetch(COCKPIT_SHELL)
          .then((response) => (cacheable(response) ? cache.put(COCKPIT_SHELL, response) : undefined))
          .catch(() => undefined),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cockpit-") && !KNOWN_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isStaticExtra(url) {
  return url.pathname.startsWith("/icons/") || url.pathname === "/manifest-cockpit.webmanifest";
}

function isCockpitNavigation(request, url) {
  return (
    request.mode === "navigate" &&
    (url.pathname === COCKPIT_SHELL || url.pathname.startsWith(`${COCKPIT_SHELL}/`))
  );
}

/**
 * Only successful, basic (same-origin, non-opaque), non-redirected
 * responses are cached: a /cockpit request that bounced to /login must
 * never become the offline shell.
 */
function cacheable(response) {
  return response && response.ok && response.type === "basic" && !response.redirected;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (fallbackUrl ? await cache.match(fallbackUrl) : undefined);
    if (cached) return cached;
    // Minimal offline page: no HTML template dependency, no translation
    // (the real copy lives in the app; this is the last-resort fallback).
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cockpit</title><body style="margin:0;background:#0A0806;color:#F6F0E6;font:600 20px system-ui;display:grid;place-items:center;height:100vh"><p>Sem ligação. A religar…</p><script>setTimeout(function(){location.reload()},3000)</script></body>',
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // actions go through the page queue
  const url = new URL(request.url);
  if (!isSameOrigin(url) || isApi(url)) return; // network only, untouched

  if (isCockpitNavigation(request, url)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, COCKPIT_SHELL));
    return;
  }
  if (isBuildAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (isStaticExtra(url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});
