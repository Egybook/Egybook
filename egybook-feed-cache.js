/* EgyBook account-scoped Smart Feed snapshots v44.
 * Stores only whitelisted post metadata returned by the viewer's RLS query.
 * Private rows are scoped to that viewer and revalidated on every reload.
 * Never stores auth, messages, notifications, signed URLs, or media bytes. */
(() => {
  'use strict';
  if (window.EgyBookFeedCache?.version === 44) return;

  const DB_NAME = 'egybook-feed-snapshot-v42';
  const DB_VERSION = 2;
  const STORE = 'feedSnapshots';
  const PROFILE_STORE = 'profileSnapshots';
  const MAX_ROWS = 80;
  const MAX_PROFILE_ROWS = 120;
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  // RLS-authorized non-public rows are cached only for a short account-scoped
  // window, then removed from the paint snapshot and re-fetched from Supabase.
  const PRIVATE_ROW_MAX_AGE_MS = MAX_AGE_MS;
  const FRESH_RELOAD_WINDOW_MS = 60 * 1000;
  let dbPromise = null;
  let activeUserId = null;
  const writeQueue = new Map();
  const profileWriteQueue = new Map();

  function openDB() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'userId' });
          if (!db.objectStoreNames.contains(PROFILE_STORE)) db.createObjectStore(PROFILE_STORE, { keyPath: 'cacheKey' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }

  function isPublicRow(row) {
    const visibility = String(row?.visibility || '').trim().toLowerCase();
    return ['الجميع','عام','public','everyone','all'].includes(visibility);
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

  function sanitizeRows(rows, viewerId, limit = MAX_ROWS) {
    const byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      // Rows arrive here only from a Supabase query already filtered by RLS.
      // Keep them scoped to this viewer; never share snapshots between accounts.
      if (!row || !row.id || !row.user_id) return;
      const clean = {};
      [
        'id', 'user_id', 'text', 'media_type', 'visibility', 'created_at', 'updated_at', 'pinned_at',
        'feeling', 'activity', 'location_name', 'music_title', 'music_artist',
        'music_track_id', 'music_permalink', 'music_start_seconds', 'music_duration_seconds', 'audio_source_post_id'
      ].forEach(key => { if (row[key] !== undefined && row[key] !== null) clean[key] = row[key]; });
      clean.media_url = safeMediaURL(row.media_url) || null;
      clean.media_urls = (Array.isArray(row.media_urls) ? row.media_urls : [])
        .map(safeMediaURL).filter(Boolean).slice(0, 10);
      clean.music_artwork_url = safeMediaURL(row.music_artwork_url) || '';
      clean.tagged_user_ids = [];
      clean.__viewer_cache_private = !isPublicRow(row);
      clean.__viewer_cache_owner = String(viewerId);
      byId.set(String(clean.id), clean);
    });
    return [...byId.values()].sort((a, b) => {
      const dateDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
      return dateDiff || String(b.id).localeCompare(String(a.id));
    }).slice(0, limit);
  }

  async function purgeExcept(userId) {
    const db = await openDB();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction([STORE, PROFILE_STORE], 'readwrite');
        const feedStore = tx.objectStore(STORE);
        const profileStore = tx.objectStore(PROFILE_STORE);
        const feedKeys = feedStore.getAllKeys();
        feedKeys.onsuccess = () => (feedKeys.result || []).forEach(key => {
          if (!userId || String(key) !== String(userId)) feedStore.delete(key);
        });
        const profileKeys = profileStore.getAllKeys();
        profileKeys.onsuccess = () => (profileKeys.result || []).forEach(key => {
          if (!userId || !String(key).startsWith(`${userId}::`)) profileStore.delete(key);
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
    await purgeExcept(next);
    return true;
  }

  function readStore(storeName, key, ownerId = '') {
    return openDB().then(db => {
      if (!db) return null;
      return new Promise(resolve => {
        try {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onsuccess = () => {
            const item = request.result;
            if (!item || !Array.isArray(item.rows) || Date.now() - Number(item.savedAt || 0) > MAX_AGE_MS) {
              if (item) void removeStore(storeName, key);
              resolve(null); return;
            }
            if (ownerId && String(item.viewerId || item.userId || '') !== String(ownerId)) { resolve(null); return; }
            const savedAt = Number(item.savedAt) || 0;
            const age = Date.now() - savedAt;
            // Friends-only / restricted rows are a short-lived convenience cache
            // for the same signed-in viewer. They are always revalidated because
            // firstPageComplete remains false whenever a restricted row exists.
            const keepRow = row => !row?.__viewer_cache_private || age <= PRIVATE_ROW_MAX_AGE_MS;
            resolve({ rows: item.rows.filter(keepRow),
              firstPageRows: (Array.isArray(item.firstPageRows) ? item.firstPageRows : []).filter(keepRow),
              firstPageAt: Number(item.firstPageAt) || 0, firstPageComplete: item.firstPageComplete === true, savedAt,
              stale: age > 6 * 60 * 60 * 1000,
              complete: !!item.complete });
          };
          request.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    });
  }

  async function read(userId) {
    const key = String(userId || '');
    if (!key || key !== activeUserId) return null;
    return readStore(STORE, key, key);
  }

  async function write(userId, rows, isFirstPage = true) {
    const key = String(userId || '');
    if (!key || key !== activeUserId || !Array.isArray(rows)) return false;
    if (!rows.length && !isFirstPage) return false;
    const previous = writeQueue.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (key !== activeUserId) return false;
      const db = await openDB();
      if (!db) return false;
      const cached = await read(key);
      const safeRows = sanitizeRows(rows, key, MAX_ROWS);
      // On a first-page refresh, replace the prior first-page slice while
      // retaining cached older pages. This prevents deleted/reordered recent
      // posts from lingering in the offline snapshot.
      const oldFirstIds = isFirstPage ? new Set((cached?.firstPageRows || []).map(row => String(row.id))) : null;
      const retainedRows = isFirstPage
        ? (rows.length ? (cached?.rows || []).filter(row => !oldFirstIds.has(String(row.id))) : [])
        : (cached?.rows || []);
      const merged = sanitizeRows([...retainedRows, ...safeRows], key, MAX_ROWS);
      const now = Date.now();
      const firstPageRows = isFirstPage ? safeRows : (cached?.firstPageRows || []);
      const firstPageAt = isFirstPage ? now : (cached?.firstPageAt || 0);
      const firstPageComplete = isFirstPage ? rows.every(isPublicRow) : (cached?.firstPageComplete === true);
      return new Promise(resolve => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ userId: key, savedAt: now, firstPageAt, firstPageRows, firstPageComplete, rows: merged });
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

  function profileKey(viewerId, ownerId) { return `${String(viewerId || '')}::${String(ownerId || '')}`; }
  async function readProfile(viewerId, ownerId) {
    const viewer = String(viewerId || ''), owner = String(ownerId || '');
    if (!viewer || !owner || viewer !== activeUserId) return null;
    return readStore(PROFILE_STORE, profileKey(viewer, owner), viewer);
  }

  async function writeProfile(viewerId, ownerId, rows) {
    const viewer = String(viewerId || ''), owner = String(ownerId || '');
    if (!viewer || !owner || viewer !== activeUserId || !Array.isArray(rows)) return false;
    const key = profileKey(viewer, owner);
    const previous = profileWriteQueue.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (viewer !== activeUserId) return false;
      const db = await openDB();
      if (!db) return false;
      const safeRows = sanitizeRows(rows, viewer, MAX_PROFILE_ROWS).filter(row => String(row.user_id) === owner);
      if (!safeRows.length) return removeStore(PROFILE_STORE, key);
      // Only skip a profile refresh briefly when every returned row was public,
      // fit inside the cache limit, and the query did not hit its 500-row cap.
      const complete = rows.length <= MAX_PROFILE_ROWS && rows.length < 500 && rows.every(isPublicRow);
      return new Promise(resolve => {
        try {
          const tx = db.transaction(PROFILE_STORE, 'readwrite');
          tx.objectStore(PROFILE_STORE).put({ cacheKey: key, viewerId: viewer, ownerId: owner, savedAt: Date.now(), complete, rows: safeRows });
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    });
    profileWriteQueue.set(key, task);
    const result = await task;
    if (profileWriteQueue.get(key) === task) profileWriteQueue.delete(key);
    return result;
  }

  async function removeStore(storeName, key) {
    const db = await openDB();
    if (!db || !key) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function remove(userId) {
    const key = String(userId || '');
    if (!key) return false;
    const db = await openDB();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction([STORE, PROFILE_STORE], 'readwrite');
        tx.objectStore(STORE).delete(key);
        const keys = tx.objectStore(PROFILE_STORE).getAllKeys();
        keys.onsuccess = () => (keys.result || []).forEach(itemKey => {
          if (String(itemKey).startsWith(`${key}::`)) tx.objectStore(PROFILE_STORE).delete(itemKey);
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  window.EgyBookFeedCache = Object.freeze({
    version: 44, freshReloadWindowMs: FRESH_RELOAD_WINDOW_MS,
    bind, read, write, readProfile, writeProfile, remove
  });
})();
