/* EgyBook Smart Video Buffer Manager
 * Owns only the small in-memory pool of adjacent preview media elements.
 * The core player remains the sole playback/audio owner. This manager never
 * fetches media itself and never touches Service Worker, Supabase, or R2.
 */
(() => {
  'use strict';
  if (window.__egybookVideoBufferManager) return;

  const PRIORITY = { previous: 1, next: 2 };

  function create(options = {}) {
    const maxEntries = Math.max(1, Math.min(3, Number(options.maxEntries) || 2));
    const entries = new Map();
    let sequence = 0;

    function release(node) {
      if (!node || node.isConnected) return false;
      try { node.pause?.(); } catch (_) {}
      try {
        if (node instanceof HTMLVideoElement) {
          node.removeAttribute('src');
          node.load();
        } else if (node instanceof HTMLImageElement) {
          node.removeAttribute('src');
        }
      } catch (_) {}
      return true;
    }

    function evictIfNeeded() {
      while (entries.size > maxEntries) {
        let candidate = null;
        for (const [key, record] of entries) {
          // A connected preview is currently serving as the transition cover.
          if (record.node?.isConnected) continue;
          if (!candidate || record.priority < candidate.record.priority ||
              (record.priority === candidate.record.priority && record.order < candidate.record.order)) {
            candidate = { key, record };
          }
        }
        // A live transition may temporarily pin an entry. It will be eligible
        // for eviction after it leaves the DOM and the next queue update runs.
        if (!candidate) break;
        entries.delete(candidate.key);
        release(candidate.record.node);
      }
    }

    return {
      get size() { return entries.size; },
      get(key) { return entries.get(key)?.node; },
      has(key) { return entries.has(key); },
      set(key, node, meta = {}) {
        if (!key || !node) return this;
        const old = entries.get(key);
        entries.set(key, {
          node,
          priority: PRIORITY[meta.priority] || old?.priority || 0,
          order: old?.order || ++sequence
        });
        evictIfNeeded();
        return this;
      },
      delete(key) { return entries.delete(key); },
      *entries() { for (const [key, record] of entries) yield [key, record.node]; },
      [Symbol.iterator]() { return this.entries(); },
      trim() { evictIfNeeded(); },
      stats() {
        let videos = 0, readyFrames = 0, connected = 0;
        for (const record of entries.values()) {
          const node = record.node;
          if (node instanceof HTMLVideoElement) {
            videos++;
            if (node.readyState >= 2 && node.videoWidth > 0 && node.videoHeight > 0) readyFrames++;
          }
          if (node?.isConnected) connected++;
        }
        return { entries: entries.size, videos, readyFrames, connected, limit: maxEntries };
      }
    };
  }

  window.__egybookVideoBufferManager = Object.freeze({ create });
})();
