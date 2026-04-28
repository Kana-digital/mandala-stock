/* マンダラ株分析 — Service Worker
 * 戦略:
 *  - app shell（HTML/CSS/JS）: stale-while-revalidate
 *  - /api/*: network-first, cache fallback (オフライン時の最終手段)
 *  - 画像/アイコン: cache-first
 *  - データ自体は IndexedDB なのでここでは触らない
 */

const VERSION = 'mandala-v2-game';
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const IMG_CACHE = `${VERSION}-img`;

const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 同一オリジンのみ扱う
  if (url.origin !== self.location.origin) return;

  // /api/* → network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // 画像/アイコン → cache-first
  if (url.pathname.startsWith('/icons/') || /\.(png|jpg|jpeg|svg|gif|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // それ以外（HTML/CSS/JS）→ stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
