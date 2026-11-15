/* EgyBook account-scoped feed snapshot cache v42.
 * Stores only RLS-returned feed rows for the active account. Never stores auth,
 * messages, notifications, private media tokens, or signed media URLs.
 */
(() => {
  'use strict';
  if (window.EgyBookFeedCache?.version === 42) return;

  const DB_NAME = 'egybook-feed-snapshot-v42';
  const DB_VERSION = 1;
  const STORE = 'feedSnapshots';
  const MAX_ROWS = 60;
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const FRESH_RELOAD_WINDOW_MS = 30 * 1000;
  let dbPromise = null;
  let activeUserId = null;
  const writeQueue = new Map();

  function openDB() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'userId' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }

  function safeMediaURL(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return '';
    try {
      const url = new URL(value);
      if ([...url.searchParams.keys()].some(key => /token|signature|sig|expires|auth|credential/i.test(key))) return '';
      if (/\/(?:private|messages|auth|signed)(?:\/|$)/i.test(url.pathname)) return '';
      return url.href.slice(0, 2048);
    } catch (_) { return ''; }
  }

  function sanitizeRows(rows, viewerId) {
    const byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row || !row.id || !row.user_id) return;
      // Cache only public posts. Audience-restricted rows are never persisted,
      // so a later privacy change cannot expose stale friends-only content.
      const visibility = String(row.visibility || '').trim().toLowerCase();
      if (!['الجميع','عام','public','everyone','all'].includes(visibility)) return;
      const clean = {};
      [
        'id', 'user_id', 'text', 'media_type', 'visibility', 'created_at', 'updated_at',
        'feeling', 'activity', 'location_name', 'music_title', 'music_artist',
        'music_track_id', 'music_permalink', 'music_start_seconds', 'music_duration_seconds', 'audio_source_post_id'
      ].forEach(key => { if (row[key] !== undefined && row[key] !== null) clean[key] = row[key]; });
      clean.media_url = safeMediaURL(row.media_url) || null;
      clean.media_urls = (Array.isArray(row.media_urls) ? row.media_urls : [])
        .map(safeMediaURL).filter(Boolean).slice(0, 10);
      clean.music_artwork_url = safeMediaURL(row.music_artwork_url) || '';
      // Do not persist audience lists, tagged-user lists, comments, or action state.
      // The audio source post ID is retained only as a public-content reference.
      clean.tagged_user_ids = [];
      clean.__viewer_cache_owner = String(viewerId);
      byId.set(String(clean.id), clean);
    });
    return [...byId.values()].sort((a, b) => {
      const dateDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
      return dateDiff || String(b.id).localeCompare(String(a.id));
    }).slice(0, MAX_ROWS);
  }

  async function purgeExcept(userId) {
    const db = await openDB();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const request = store.getAllKeys();
        request.onsuccess = () => (request.result || []).forEach(key => {
          if (!userId || String(key) !== String(userId)) store.delete(key);
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function bind(userId) {
    const next = userId ? String(userId) : null;
    if (next === activeUserId) return true;
    activeUserId = next;
    // Switching account or signing out must not leave another account's feed
    // available to the next session on this shared browser/device.
    await purgeExcept(next);
    return true;
  }

  async function read(userId) {
    const key = String(userId || '');
    if (!key || key !== activeUserId) return null;
    const db = await openDB();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        request.onsuccess = () => {
          const item = request.result;
          if (!item || !Array.isArray(item.rows) || Date.now() - Number(item.savedAt || 0) > MAX_AGE_MS) {
            if (item) void remove(key);
            resolve(null);
            return;
          }
          resolve({ rows: item.rows, savedAt: Number(item.savedAt) || 0, stale: Date.now() - Number(item.savedAt || 0) > 6 * 60 * 60 * 1000 });
        };
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function write(userId, rows) {
    const key = String(userId || '');
    if (!key || key !== activeUserId || !Array.isArray(rows) || !rows.length) return false;
    const previous = writeQueue.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (key !== activeUserId) return false;
      const db = await openDB();
      if (!db) return false;
      const cached = await read(key);
      const merged = sanitizeRows([...(cached?.rows || []), ...rows], key);
      if (!merged.length) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ userId: key, savedAt: Date.now(), rows: merged });
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    });
    writeQueue.set(key, task);
    const result = await task;
    if (writeQueue.get(key) === task) writeQueue.delete(key);
    return result;
  }

  async function remove(userId) {
    const key = String(userId || '');
    const db = await openDB();
    if (!db || !key) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  window.EgyBookFeedCache = Object.freeze({ version: 42, freshReloadWindowMs: FRESH_RELOAD_WINDOW_MS, bind, read, write, remove });
})();
