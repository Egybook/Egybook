/* EgyBook Smart Feed session state v43.
 * Restores scroll/video playheads without caching media bytes or private records. */
(() => {
  'use strict';
  if (window.EgyBookSmartFeed?.version === 43) return;

  const STORAGE_PREFIX = 'egybook_smart_feed_session_v43:';
  const MAX_MEDIA_ITEMS = 12;
  const SAVE_INTERVAL_MS = 12000;
  const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  let activeUserId = null;
  let trackedVideos = new Map();
  let lastSavedAt = 0;
  let scrollRestoreStarted = false;
  let userInteracted = false;
  let scrollSaveTimer = 0;

  function currentPath() {
    return `${location.pathname}${location.search}`;
  }

  function storageKey() {
    return `${STORAGE_PREFIX}${activeUserId || 'guest'}`;
  }

  function readState() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
      if (!parsed || Date.now() - Number(parsed.updatedAt || 0) > SESSION_MAX_AGE_MS) return null;
      if (String(parsed.path || '') !== currentPath()) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function bind(userId) {
    const next = userId ? String(userId) : null;
    if (next === activeUserId) return;
    activeUserId = next;
    trackedVideos = new Map();
    lastSavedAt = 0;
    scrollRestoreStarted = false;
    userInteracted = false;
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = 0;
  }

  function snapshotMedia() {
    const result = {};
    trackedVideos.forEach((video, postId) => {
      if (!video?.isConnected) { trackedVideos.delete(postId); return; }
      const time = Number(video.currentTime);
      if (Number.isFinite(time) && time >= 0) {
        result[postId] = { time: Math.round(time * 10) / 10, wasPlaying: !video.paused && !video.ended };
      }
    });
    const entries = Object.entries(result).slice(-MAX_MEDIA_ITEMS);
    return Object.fromEntries(entries);
  }

  function saveNow() {
    try {
      const payload = {
        path: currentPath(),
        updatedAt: Date.now(),
        scrollY: Math.max(0, Number(window.scrollY) || 0),
        media: snapshotMedia()
      };
      sessionStorage.setItem(storageKey(), JSON.stringify(payload));
      lastSavedAt = Date.now();
      return true;
    } catch (_) { return false; }
  }

  function maybeSave() {
    if (Date.now() - lastSavedAt < SAVE_INTERVAL_MS) return;
    saveNow();
  }

  function restoreVideo(video, record) {
    if (!video || !record || video.dataset.smartFeedRestoreApplied === '1') return;
    const time = Number(record.time);
    if (!Number.isFinite(time) || time <= 0) return;
    const apply = () => {
      if (video.dataset.smartFeedRestoreApplied === '1') return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const safeTime = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.25)));
      try {
        if (video.currentTime < 0.5) video.currentTime = safeTime;
        video.dataset.smartFeedRestoreApplied = '1';
        video.dataset.smartFeedRestoredTime = String(safeTime);
      } catch (_) {}
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
  }

  function registerVideo(video, postId) {
    const id = String(postId || '');
    if (!video || !id) return;
    trackedVideos.set(id, video);
    video.dataset.smartFeedPostId = id;
    const saved = readState();
    restoreVideo(video, saved?.media?.[id]);
    if (video.dataset.smartFeedSaveBound !== '1') {
      video.dataset.smartFeedSaveBound = '1';
      video.addEventListener('timeupdate', () => {
        if (!video.paused && video.dataset.smartFeedPostId) maybeSave();
      }, { passive: true });
      video.addEventListener('loadedmetadata', () => {
        const state = readState();
        restoreVideo(video, state?.media?.[String(video.dataset.smartFeedPostId || '')]);
      }, { once: false });
    }
  }

  function restoreScroll(userId) {
    if (userId && String(userId) !== String(activeUserId || '')) return false;
    if (scrollRestoreStarted) return false;
    scrollRestoreStarted = true;
    const saved = readState();
    const targetY = Math.max(0, Number(saved?.scrollY) || 0);
    if (!targetY || window.scrollY > 12) return false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (userInteracted || window.scrollY > 12) return;
      window.scrollTo({ top: targetY, behavior: 'auto' });
    }));
    return true;
  }

  function scheduleScrollSave() {
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => { scrollSaveTimer = 0; saveNow(); }, 500);
  }

  window.addEventListener('scroll', scheduleScrollSave, { passive: true });
  ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(type => {
    window.addEventListener(type, () => { userInteracted = true; }, { passive: true, once: true });
  });
  window.addEventListener('pagehide', () => { if (scrollSaveTimer) clearTimeout(scrollSaveTimer); scrollSaveTimer = 0; saveNow(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); }, { passive: true });
  window.addEventListener('beforeunload', saveNow, { passive: true });

  window.EgyBookSmartFeed = Object.freeze({
    version: 43,
    bind,
    registerVideo,
    restoreScroll,
    saveNow
  });
})();
