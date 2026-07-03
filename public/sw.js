/* Universal Pensions — lightweight runtime-caching service worker.
 * Hand-rolled (no Workbox) so the build config stays untouched.
 * Strategy:
 *   - navigations  → network-first, fall back to the cached app shell, then offline.html
 *   - same-origin static GET → stale-while-revalidate
 *   - /api/* → never cached (balances, transactions, money flows must be fresh)
 *   - cross-origin (fonts, CDNs) → left to the browser
 */
// Bump VERSION on each release so `activate` purges the previous release's
// caches. Independently, the RUNTIME cache self-caps (trimCache below) so
// orphaned content-hashed assets from prior builds can't accumulate unbounded
// even between version bumps.
const VERSION = 'up-pwa-v2';
const SHELL = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';
const RUNTIME_MAX_ENTRIES = 80;

// FIFO-trim a cache to at most `maxEntries`, deleting the oldest keys first.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)),
  );
}

const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // fonts / api host / CDNs untouched
  if (url.pathname.startsWith('/api/')) return;       // always-fresh money data

  // App-shell navigations: network-first, fall back to cached shell, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('/index.html')) || (await cache.match('/offline.html'));
      }
    })());
    return;
  }

  // Static same-origin assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(request, res.clone()).then(() => trimCache(RUNTIME, RUNTIME_MAX_ENTRIES));
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
