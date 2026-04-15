// ----------------------------------------------------------------------
//  LEGO World service worker — offline support + install to home screen.
//
//  Strategy:
//   - App shell (/, /index.html) — network-first, fall back to cache so
//     users always see the latest HTML pointing at fresh asset hashes,
//     but still boot offline.
//   - Hashed assets (/assets/*) — cache-first; Vite's filename hashing
//     guarantees new URLs on each deploy so stale cache is never served.
//   - Runtime (/model/*, /sounds/*, manifest, icons) — stale-while-
//     revalidate: fast offline reads, refreshed in the background.
//   - Supabase + Google requests — network-only, NEVER cached.
// ----------------------------------------------------------------------

const VERSION = 'lego-world-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSETS_CACHE = `${VERSION}-assets`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

/** Files always cached on install so the app boots offline. */
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Ignore individual failures so install still completes even if
      // one resource is temporarily unreachable.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge old versions' caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // --- External APIs — never cache ---
  if (
    url.origin !== self.location.origin ||
    url.hostname.endsWith('supabase.co') ||
    url.hostname === 'accounts.google.com' ||
    url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('gstatic.com')
  ) {
    // Let them pass through. For fonts we DO want caching — fall
    // through to the default browser behaviour for those origins.
    if (
      url.hostname.endsWith('fonts.googleapis.com') ||
      url.hostname.endsWith('fonts.gstatic.com')
    ) {
      event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    }
    return;
  }

  // --- App shell (HTML) — network-first, fall back to cache ---
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // --- Hashed Vite assets — cache-first ---
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, ASSETS_CACHE));
    return;
  }

  // --- Static runtime (models, sounds, icons, manifest) — stale-while-revalidate ---
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(cacheName);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Final fallback — return the cached index.html if anything asks
    // for a page we haven't seen before.
    return caches.match('/index.html');
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  const cache = await caches.open(cacheName);
  cache.put(req, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
