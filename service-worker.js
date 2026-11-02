/* EgyBook Smart Service Worker v159
 * Scope: /Egybook/ (GitHub Pages project path).
 * Cache only public same-origin app shell/static assets. Never cache auth, API,
 * private user data, or media. Never retry non-GET requests.
 */
const VERSION = 'egybook-smart-v159';
const CACHE_PREFIX = 'egybook-';
const BASE = '/Egybook/';
const MAX_STATIC_ENTRIES = 32;
const NETWORK_TIMEOUT_MS = 5000;
const CORE_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'styles.css?v=154-white-cards-stats-profile',
  BASE + 'composer-rebuild.css?v=146-white-components-repair',
  BASE + 'script.js?v=154-stats-idempotency',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png',
  BASE + 'performance-manager.js?v=158',
  BASE + 'network-manager.js?v=158',
  BASE + 'storage-manager.js?v=159'
];
const SHELL_URLS = new Set(CORE_ASSETS.map(path => new URL(path, self.location.origin).href));
const inFlight = new Map();

function isPublicAppRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith(BASE)) return false;
  if (url.searchParams.has('token') || url.searchParams.has('access_token')) return false;
  // Do not cache Supabase endpoints, authenticated content, or media.
  if (/\/(?:rest\/v1|auth\/v1|storage\/v1|realtime\/v1|functions\/v1)(?:\/|$)/i.test(url.pathname)) return false;
  if (/\.(?:m3u8|mp4|webm|mov|mp3|aac|wav|ogg|m4a)(?:$|\/)/i.test(url.pathname)) return false;
  if (/\/(?:uploads|avatars|private|messages)(?:\/|$)/i.test(url.pathname)) return false;
  return true;
}

async function networkWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function putIfCacheable(cache, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const control = response.headers.get('Cache-Control') || '';
  if (/no-store|private/i.test(control)) return;
  await cache.put(request, response.clone());
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const shell = new Set([...SHELL_URLS]);
  const dynamic = keys.filter(req => !shell.has(req.url));
  const excess = dynamic.length - MAX_STATIC_ENTRIES;
  if (excess > 0) {
    // Cache API key order is insertion order; remove oldest dynamic entries.
    await Promise.all(dynamic.slice(0, excess).map(req => cache.delete(req)));
  }
}

async function deduplicatedFetch(request) {
  const key = request.url;
  if (inFlight.has(key)) return (await inFlight.get(key)).clone();
  const task = fetch(request);
  inFlight.set(key, task);
  try {
    return (await task).clone();
  } finally {
    inFlight.delete(key);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Precache only the small app shell and essential same-origin files.
    await cache.addAll(CORE_ASSETS.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'EGB_VERSION_READY', version: VERSION }));
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'EGB_SKIP_WAITING') self.skipWaiting();
  if (data.type === 'EGB_CLEAR_OLD_CACHE') {
    event.waitUntil(caches.keys().then(names => Promise.all(
      names.filter(name => name.startsWith(CACHE_PREFIX) && name !== VERSION)
        .map(name => caches.delete(name))
    )));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isPublicAppRequest(request, url)) return;

  // Navigation: network-first with bounded timeout; use cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await networkWithTimeout(request);
        if (response && response.ok) {
          await putIfCacheable(cache, BASE, response);
          await putIfCacheable(cache, BASE + 'index.html', response);
        }
        return response;
      } catch (_) {
        return (await cache.match(request)) ||
          (await cache.match(BASE)) ||
          (await cache.match(BASE + 'index.html')) ||
          new Response('أنت غير متصل بالإنترنت. حاول مرة أخرى عند عودة الاتصال.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  // Static code/assets: stale-while-revalidate. Cached copy renders quickly;
  // successful network response refreshes the cache in the background.
  if (/\.(?:css|js|webmanifest|svg|woff2?)(?:$)/i.test(url.pathname)) {
    const cachePromise = caches.open(VERSION);
    const refresh = (async () => {
      try {
        const cache = await cachePromise;
        const response = await networkWithTimeout(request);
        await putIfCacheable(cache, request, response);
        await trimCache(cache);
        return response;
      } catch (_) {
        return null;
      }
    })();
    // Extend the fetch event for background refresh even when cached data wins.
    event.waitUntil(refresh);
    event.respondWith((async () => {
      const cache = await cachePromise;
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await refresh;
      return response || new Response('', { status: 504, statusText: 'Offline' });
    })());
    return;
  }

  // Other public same-origin GET requests: network first, one cache fallback.
  // In-flight requests for identical URLs share a single network operation.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await deduplicatedFetch(request);
      if (response && response.ok && response.type !== 'opaque') {
        await putIfCacheable(cache, request, response.clone());
        await trimCache(cache);
      }
      return response;
    } catch (_) {
      return (await cache.match(request)) ||
        new Response('', { status: 503, statusText: 'Network unavailable' });
    }
  })());
});

// Best-effort storage pressure cleanup. Browser-managed storage is not cleared.
self.addEventListener('message', event => {
  if (event.data?.type !== 'EGB_STORAGE_MAINTENANCE') return;
  event.waitUntil((async () => {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    if (quota && usage / quota > 0.85) {
      const cache = await caches.open(VERSION);
      const keys = await cache.keys();
      const shell = new Set([...SHELL_URLS]);
      const removable = keys.filter(req => !shell.has(req.url));
      await Promise.all(removable.slice(0, Math.ceil(removable.length / 2)).map(req => cache.delete(req)));
    }
  })());
});
