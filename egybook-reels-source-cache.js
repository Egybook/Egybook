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

  window.EgyBookReelsSourceCache = Object.freeze({ version: VERSION, read, write, clear,
    freshMs: FRESH_MS, maxAgeMs: MAX_AGE_MS });
})();
