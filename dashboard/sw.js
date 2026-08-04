/* ============================================================
   PBC COMMAND CENTER — service worker

   Scope is /dashboard/ (set by where this file sits and by the manifest), so
   nothing here can affect the rest of pickleballchiro.co.

   It caches the app shell and nothing else. Business data — clients, phone
   numbers, revenue — is never written to the Cache API: the fetch handler
   bails on anything that isn't same-origin, and asserts the same thing again
   below in case the webhook is ever proxied through this origin.

   ON DEPLOY: bump SHELL_VERSION *and* the ?v= numbers in index.html together.
   The precache list has to name the exact URLs the page requests, query string
   included, or a version bump would serve the previous file forever.
   ============================================================ */

const SHELL_VERSION = "v9";
const CACHE = "pbc-shell-" + SHELL_VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./dashboard.css?v=9",
  "./dashboard.js?v=9",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin — the Apps Script webhook and Google Fonts — goes straight to
  // the network, uncached. Offline that means no data and no webfonts; the page
  // falls back to a system sans-serif and shows its connection error, which is
  // the honest outcome.
  if (url.origin !== self.location.origin) return;

  // Belt and braces: even same-origin, a dashboard-data URL is never cached.
  if (url.searchParams.has("action") || url.searchParams.has("key")) return;

  // Navigations go network-first so a deploy lands on the next open rather than
  // whenever the cache happens to turn over. The cached shell is the fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Stale-while-revalidate for the rest of the shell: answer from cache so a
  // warm open is instant, and refresh the entry in the background for next time.
  //
  // Cache-first would be faster to write and is what version-stamped URLs
  // normally justify — but it fails badly in the one case that matters here.
  // Editing dashboard.js without also bumping SHELL_VERSION and the ?v= params
  // leaves the URL unchanged, so a cache-first worker would serve the old file
  // to an installed phone forever with no signal that anything is wrong.
  // Revalidating costs one background request and makes a forgotten bump land
  // on the next open instead of never.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok && res.type === "basic") cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit); // offline: the cached copy is the answer
        return hit || fresh;
      })
    )
  );
});
