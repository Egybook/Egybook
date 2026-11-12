/* EgyBook Service Worker v2010
 * Derive the project base from the registered scope. This avoids path-case
 * mismatches on GitHub Pages (for example /Egybook/ vs /EgyBook/).
 *
 * Cache policy:
 * - Cache only the public app shell and same-origin static app assets.
 * - Network-first for HTML/CSS/JS so deployments are not hidden by stale code.
 * - Never cache Supabase/API responses, private data, or media.
 * - Never replay or retry non-GET requests.
 */
'use strict';

const VERSION = '2026-11-facebook-reels-video-push-v17';
const CACHE_PREFIX = 'egybook-app-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const BASE_URL = new URL('./', self.registration.scope);
const BASE_PATH = BASE_URL.pathname;
const NETWORK_TIMEOUT_MS = 7000;
const MAX_DYNAMIC_ENTRIES = 24;

const CORE_ASSETS = [
  '',
  'index.html',
  'manifest.webmanifest',
  'styles.css?v=2008-separated-viewers',
  'infinite-scroll.css?v=2026-stage5-modular',
  'swipe-navigation.css?v=2026-11-facebook-reels-video-push-v17',
  'media-frame-guard.css?v=2026-11-frame-guard-no-double-load-v12',
  'media-frame-guard.js?v=2026-11-frame-guard-no-double-load-v12',
  'image-player.css?v=2008-separated-viewers',
  'composer-rebuild.css?v=146-white-components-repair',
  'responsive-optimization.css?v=160',
  'video-player.css?v=2026-11-video-stage-single-owner-v10',
  'evp-video-network-indicator.css?v=2-video-load-buffer-only',
  'performance-manager.js?v=160',
  'network-manager.js?v=208',
  'storage-manager.js?v=165',
  'video-player.js?v=2015-feed-video-open-recovery',
  'evp-video-network-indicator.js?v=2-video-load-buffer-only',
  'video-transcode-engine.js?v=2025-smart-video-engine',
  'script.js?v=2026-11-facebook-video-push-v16',
  'egybook-moments.js?v=1-separated-engine',
  'egybook-moments.css?v=1-separated-engine',
  'infinite-scroll.js?v=2026-11-unified-vertical-push-v15',
  'swipe-navigation.js?v=2026-11-facebook-reels-video-push-v17',
  'evp-caption-layout.js?v=2026-11-video-stage-single-owner-v9',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
].map(path => new URL(path, BASE_URL).href);

const CORE_SET = new Set(CORE_ASSETS);
const inFlight = new Map();

function isWithinApp(url) {
  return url.origin === self.location.origin &&
    (url.pathname === BASE_PATH.slice(0, -1) || url.pathname.startsWith(BASE_PATH));
}

function isSensitiveOrMedia(url) {
  if (url.searchParams.has('token') || url.searchParams.has('access_token') ||
      url.searchParams.has('sig') || url.searchParams.has('signature')) return true;
  if (/\/(?:rest\/v1|auth\/v1|storage\/v1|realtime\/v1|functions\/v1)(?:\/|$)/i.test(url.pathname)) return true;
  if (/\/(?:uploads|avatars|private|messages)(?:\/|$)/i.test(url.pathname)) return true;
  if (/\.(?:m3u8|mp4|webm|mov|mp3|aac|wav|ogg|m4a)(?:$|\/)/i.test(url.pathname)) return true;
  return false;
}

function isStaticAppAsset(url) {
  return /\.(?:css|js|webmanifest|svg|woff2?|png|jpe?g|webp|ico)(?:$)/i.test(url.pathname);
}

function cacheableResponse(response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const control = response.headers.get('Cache-Control') || '';
  return !/(?:no-store|private)/i.test(control);
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function saveResponse(cache, request, response) {
  if (cacheableResponse(response)) {
    try { await cache.put(request, response.clone()); } catch (_) {}
  }
}

async function trimDynamicEntries(cache) {
  try {
    const keys = await cache.keys();
    const dynamic = keys.filter(request => !CORE_SET.has(request.url));
    const excess = dynamic.length - MAX_DYNAMIC_ENTRIES;
    if (excess > 0) {
      await Promise.all(dynamic.slice(0, excess).map(request => cache.delete(request)));
    }
  } catch (_) {}
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      await saveResponse(cache, request, response);
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _;
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Do not fail the entire SW install because one optional asset is missing.
    await Promise.all(CORE_ASSETS.map(async href => {
      try {
        const request = new Request(href, { cache: 'reload', credentials: 'same-origin' });
        const response = await fetchWithTimeout(request);
        await saveResponse(cache, request, response);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'EGB_VERSION_READY', version: VERSION });
    }
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'EGB_SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (data.type === 'EGB_STORAGE_MAINTENANCE') {
    event.waitUntil((async () => {
      try {
        if (!self.navigator?.storage?.estimate) return;
        const estimate = await self.navigator.storage.estimate();
        const quota = estimate.quota || 0;
        const usage = estimate.usage || 0;
        if (quota && usage / quota > 0.90) {
          const cache = await caches.open(CACHE_NAME);
          await trimDynamicEntries(cache);
        }
      } catch (_) {}
    })());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isWithinApp(url) || isSensitiveOrMedia(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await networkFirst(request);
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(new URL('index.html', BASE_URL).href)) ||
          new Response('أنت غير متصل بالإنترنت. حاول مرة أخرى عند عودة الاتصال.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  if (isStaticAppAsset(url)) {
    event.respondWith((async () => {
      try {
        return await networkFirst(request);
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) ||
          new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Do not intercept arbitrary app data requests. They remain network-owned.
});
