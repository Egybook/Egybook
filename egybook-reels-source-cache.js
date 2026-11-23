/* EgyBook Reels Source Cache V221.
 * Caches only public Neon Reels catalog metadata for the current tab session.
 * Linked Supabase posts are still revalidated through the viewer's RLS on every load.
 * No auth tokens, private post text, or profile data are stored here.
 */
(() => {
  'use strict';
  if (window.EgyBookReelsSourceCache?.version === 1) return;

  const VERSION = 1;
  const PREFIX = 'egybook:reels-catalog:v221:';
  const FRESH_MS = 45_000;
  const MAX_AGE_MS = 5 * 60_000;
  const MAX_PAGES_PER_ACCOUNT = 3;
  const MAX_ROWS = 50;
  const memory = new Map();

  function cacheSafeUrl(value) {
    const raw = String(value ?? '').trim().slice(0, 2048);
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      if (url.username || url.password) return '';
      for (const key of url.searchParams.keys()) {
        if (/^(?:token|access_token|playback_token|sig|signature|authorization|ticket)$/i.test(key)) return '';
      }
      return url.href;
    } catch (_) { return ''; }
  }

  function normalizeRow(row) {
    if (!row || typeof row !== 'object') return null;
    const id = String(row.id ?? '').trim();
    const userId = String(row.user_id ?? '').trim();
    const videoUrl = cacheSafeUrl(row.video_url);
    if (!/^\d+$/.test(id) || !userId || !videoUrl) return null;
    const thumbnail = cacheSafeUrl(row.thumbnail_url);
    return {
      id,
      user_id: userId,
      video_url: videoUrl,
      thumbnail_url: thumbnail,
      caption: String(row.caption ?? '').slice(0, 2000),
      created_at: String(row.created_at ?? '').slice(0, 80),
      post_id: row.post_id == null ? null : String(row.post_id).slice(0, 128)
    };
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.reels)) return null;
    const reels = payload.reels.slice(0, MAX_ROWS).map(normalizeRow).filter(Boolean);
    const nextOffset = Number(payload.next_offset);
    return {
      reels,
      has_more: payload.has_more === true,
      next_offset: Number.isSafeInteger(nextOffset) && nextOffset >= 0 ? nextOffset : reels.length
    };
  }

  function storageKey(userId, offset) {
    const id = String(userId || '').trim();
    const pageOffset = Math.max(0, Math.floor(Number(offset) || 0));
    if (!id || id.length > 128) return '';
    return `${PREFIX}${encodeURIComponent(id)}:${pageOffset}`;
  }

  function read(userId, offset = 0) {
    const key = storageKey(userId, offset);
    if (!key) return null;
    let entry = memory.get(key) || null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved && saved.version === VERSION && saved.userId === String(userId) &&
          Number(saved.offset) === Math.max(0, Math.floor(Number(offset) || 0)) &&
          (!entry || Number(saved.updatedAt) > Number(entry.updatedAt))) entry = saved;
    } catch (_) {}
    if (!entry || !Number.isFinite(Number(entry.updatedAt))) return null;
    const age = Date.now() - Number(entry.updatedAt);
    if (age < 0 || age > MAX_AGE_MS) {
      memory.delete(key);
      try { sessionStorage.removeItem(key); } catch (_) {}
      return null;
    }
    const payload = normalizePayload(entry.payload);
    if (!payload) {
      memory.delete(key);
      try { sessionStorage.removeItem(key); } catch (_) {}
      return null;
    }
    const normalized = { version: VERSION, userId: String(userId), offset: Number(offset) || 0,
      updatedAt: Number(entry.updatedAt), payload };
    memory.set(key, normalized);
    return { payload, age, fresh: age <= FRESH_MS };
  }

  function write(userId, offset, payload) {
    const key = storageKey(userId, offset);
    const normalizedPayload = normalizePayload(payload);
    if (!key || !normalizedPayload) return false;
    const entry = { version: VERSION, userId: String(userId),
      offset: Math.max(0, Math.floor(Number(offset) || 0)), updatedAt: Date.now(), payload: normalizedPayload };
    memory.set(key, entry);
    try { sessionStorage.setItem(key, JSON.stringify(entry)); } catch (_) {}

    // Bound the per-account session footprint; never clear other accounts' entries.
    try {
      const accountPrefix = `${PREFIX}${encodeURIComponent(String(userId))}:`;
      const accountEntries = [];
      for (let index = 0; index < sessionStorage.length; index++) {
        const existingKey = sessionStorage.key(index);
        if (!existingKey || !existingKey.startsWith(accountPrefix)) continue;
        let updatedAt = 0;
        try { updatedAt = Number(JSON.parse(sessionStorage.getItem(existingKey) || '{}').updatedAt) || 0; } catch (_) {}
        accountEntries.push({ key: existingKey, updatedAt });
      }
      accountEntries.sort((a, b) => b.updatedAt - a.updatedAt);
      accountEntries.slice(MAX_PAGES_PER_ACCOUNT).forEach(item => {
        memory.delete(item.key);
        sessionStorage.removeItem(item.key);
      });
    } catch (_) {}
    return true;
  }

  function clear(userId) {
    const id = String(userId || '').trim();
    if (!id) return;
    const accountPrefix = `${PREFIX}${encodeURIComponent(id)}:`;
    for (const key of memory.keys()) if (key.startsWith(accountPrefix)) memory.delete(key);
    try {
      const keys = [];
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(accountPrefix)) keys.push(key);
      }
      keys.forEach(key => sessionStorage.removeItem(key));
    } catch (_) {}
  }

  // Insert newly published rows at the front of the catalog snapshot without
  // invalidating unrelated accounts or retaining page offsets that shifted.
  // Only public Neon catalog metadata is accepted by normalizeRow().
  function upsertPublished(userId, rows, pageSize = 20) {
    const id = String(userId || '').trim();
    if (!id || !Array.isArray(rows)) return { added: 0, payload: null };
    const limit = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 20)));
    const incomingById = new Map();
    rows.forEach(row => {
      const normalized = normalizeRow(row);
      if (normalized) incomingById.set(normalized.id, normalized);
    });
    const incoming = [...incomingById.values()];
    if (!incoming.length) return { added: 0, payload: null };

    const previous = read(id, 0)?.payload || null;
    // Without a complete known first page, caching only a newly inserted Reel
    // would make the next offset start at 1 and skip the real catalog rows 2..N.
    // Keep the real-time queue insertion in memory and let the next catalog
    // request obtain a complete page from the Worker.
    if (!previous) return { added: incoming.length, payload: null, cacheUpdated: false };
    const previousRows = Array.isArray(previous?.reels) ? previous.reels : [];
    const previousIds = new Set(previousRows.map(row => String(row.id)));
    const mergedById = new Map();
    incoming.forEach(row => mergedById.set(String(row.id), row));
    previousRows.forEach(row => {
      const key = String(row.id);
      if (!mergedById.has(key)) mergedById.set(key, row);
    });
    const merged = [...mergedById.values()].slice(0, limit);
    const added = incoming.filter(row => !previousIds.has(String(row.id))).length;
    const payload = {
      reels: merged,
      has_more: previous.has_more === true || (previousRows.length >= limit && added > 0),
      // The response offset is a row count, not the number of unique inserts
      // ever observed. Trimming to a full first page must keep it at `limit`.
      next_offset: merged.length
    };

    // Page offsets after zero may have shifted by the insertion. Clear only this
    // account's catalog pages, then seed the new first page. No media or auth
    // data is stored or removed by this operation.
    clear(id);
    write(id, 0, payload);
    return { added, payload };
  }

  window.EgyBookReelsSourceCache = Object.freeze({ version: VERSION, read, write, clear, upsertPublished,
    freshMs: FRESH_MS, maxAgeMs: MAX_AGE_MS });
})();
