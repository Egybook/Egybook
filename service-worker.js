/* EgyBook PWA worker — conservative caching: never cache authenticated/API data. */
const CACHE_NAME = 'egybook-shell-v133';
const BASE = '/Egybook/';
const SHELL = [BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png', BASE + 'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('egybook-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Do not intercept Supabase, auth, storage, media, or other dynamic requests.
  if (!url.pathname.startsWith(BASE) || /\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\.m3u8|\.mp4/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(BASE, copy));
      }
      return response;
    }).catch(() => caches.match(BASE)));
    return;
  }

  // Cache only the app shell assets; network first keeps deployments fresh.
  if (/\.(?:css|js|png|svg|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request)));
  }
});
