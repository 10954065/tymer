/* SmartLiving POS service worker.
 * - Static assets (/_next/static, icons): cache-first (they are content-hashed / versioned).
 * - Product images (/api/files): cache-first, so the POS shows pictures offline.
 * - Page navigations: network-first, falling back to the last cached copy, then to /offline.
 * - Never caches API writes or server actions (POST). Sales made offline are queued in IndexedDB by the app.
 * - Background Sync: asks open windows to flush the outbox when connectivity returns.
 */
const VERSION = "slb-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const IMAGE_CACHE = `${VERSION}-images`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (maxEntries) {
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) await cache.delete(key);
    }
  }
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    // Cache successful, non-redirected pages for offline use.
    if (response.ok && !response.redirected) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await caches.match(OFFLINE_URL));
    return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith("/api/files/")) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 400));
    return;
  }
  if (request.mode === "navigate" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/login")) {
    event.respondWith(networkFirstPage(request));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "slb-sync-sales") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: "slb-flush-outbox" });
      }),
    );
  }
});
