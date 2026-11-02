/* EgyBook PWA worker — bounded app cache; never cache authenticated/API data. */
const CACHE_NAME = 'egybook-shell-v156';
const CACHE_PREFIX = 'egybook-shell-';
const BASE = '/Egybook/';
const SHELL = [
  BASE,
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png'
];
const MAX_CACHED_ASSETS = 24;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  // Keep the app shell plus a small, bounded set of the most recently cached assets.
  const shellURLs = new Set(SHELL.map(path => new URL(path, self.location.origin).href));
  const assetKeys = keys.filter(request => !shellURLs.has(request.url));
  const excess = assetKeys.length - MAX_CACHED_ASSETS;
  if (excess > 0) {
    await Promise.all(assetKeys.slice(0, excess).map(request => cache.delete(request)));
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  // Never cache API/auth/storage responses, user content, or media files.
  if (/\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\.(?:m3u8|mp4|webm|mp3|aac|wav)(?:$|\?)/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(BASE, copy));
        }
        return response;
      }).catch(() => caches.match(BASE))
    );
    return;
  }

  // Keep only small app-code assets. Images are intentionally not cached here.
  if (/\.(?:css|js|webmanifest|svg)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(request).then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
          await trimCache(cache);
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
