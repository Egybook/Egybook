/* EgyBook Reels Stats V220 Phase 1.
   Canonical Reels counters come from Neon. Cached values are shown immediately;
   fresh server values replace them without flashing the UI to zero. */
(() => {
  'use strict';
  if (window.__egybookReelsStatsInstalled) return;
  window.__egybookReelsStatsInstalled = true;

  const WORKER = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev';
  const CACHE_PREFIX = 'egybook:reels-stats:v1:';
  const CACHE_TTL = 20_000;
  const STORAGE_TTL = 5 * 60_000;
  const memory = new Map();
  const requests = new Map();
  let activePost = null;

  const client = () => window.__egybookSupabaseClient || null;
  const formatCount = value => {
    const count = Math.max(0, Number(value) || 0);
    if (count >= 1_000_000) return (count / 1_000_000).toLocaleString('ar-EG', { maximumFractionDigits: 1 }) + ' مليون';
    if (count >= 1_000) return (count / 1_000).toLocaleString('ar-EG', { maximumFractionDigits: 1 }) + ' ألف';
    return count.toLocaleString('ar-EG');
  };

  function reelIdFor(post) {
    if (!post) return '';
    let id = String(post.dataset.reelId || '').trim();
    if (!id) {
      const video = post.querySelector('video');
      const urls = [video?.currentSrc, video?.src, video?.getAttribute('src'), post.dataset.mediaUrl, post.dataset.videoUrl].filter(Boolean);
      const map = window.__egybookVideoRecordByUrl || {};
      for (const candidate of urls) {
        id = String(map[candidate] || '').trim();
        if (id) break;
      }
    }
    return /^\d+$/.test(id) && Number(id) > 0 ? id : '';
  }

  function cacheKey(reelId) { return `${CACHE_PREFIX}${reelId}`; }

  function readCache(reelId) {
    const key = cacheKey(reelId);
    let best = memory.get(key) || null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved && saved.version === 1 && Date.now() - Number(saved.updatedAt || 0) < STORAGE_TTL &&
          (!best || Number(saved.updatedAt || 0) > Number(best.updatedAt || 0))) best = saved;
    } catch (_) {}
    if (best && Date.now() - Number(best.updatedAt || 0) < 24 * 60 * 60_000) {
      memory.set(key, best);
      return best;
    }
    return null;
  }

  function writeCache(reelId, stats) {
    const entry = { version: 1, updatedAt: Date.now(), stats };
    const key = cacheKey(reelId);
    memory.set(key, entry);
    // Keep this cache small and numeric-only; no comment text, profiles, or tokens.
    try { sessionStorage.setItem(key, JSON.stringify(entry)); } catch (_) {}
    return entry;
  }

  function apply(post, reelId, stats) {
    if (!post || !stats) return;
    const comments = Number(stats.comments_count);
    const shares = Number(stats.shares_count);
    if (Number.isFinite(comments) && comments >= 0) {
      post.dataset.cloudCommentCount = String(comments);
      const node = post.querySelector('.comment-count');
      if (node) node.textContent = formatCount(comments);
    }
    if (Number.isFinite(shares) && shares >= 0) {
      post.dataset.cloudShareCount = String(shares);
      const node = post.querySelector('.share-count');
      if (node) node.textContent = formatCount(shares);
    }
    const modal = document.querySelector('#egybookVideoModal');
    const modalPostId = String(modal?.dataset.postId || '');
    const postId = String(post.dataset.postId || '');
    // Keep duplicate feed/profile/viewer copies in sync without forcing a rerender.
    if (postId) {
      document.querySelectorAll('.post').forEach(copy => {
        if (copy === post || String(copy.dataset.postId || '') !== postId) return;
        if (Number.isFinite(comments) && comments >= 0) {
          copy.dataset.cloudCommentCount = String(comments);
          const node = copy.querySelector('.comment-count');
          if (node) node.textContent = formatCount(comments);
        }
        if (Number.isFinite(shares) && shares >= 0) {
          copy.dataset.cloudShareCount = String(shares);
          const node = copy.querySelector('.share-count');
          if (node) node.textContent = formatCount(shares);
        }
      });
    }
    if (activePost === post || (modal?.classList.contains('open') && postId && modalPostId === postId)) {
      const commentRail = document.querySelector('#evpCommentCount');
      const shareRail = document.querySelector('#evpShareCount');
      if (commentRail && Number.isFinite(comments)) commentRail.textContent = formatCount(comments);
      if (shareRail && Number.isFinite(shares)) shareRail.textContent = formatCount(shares);
    }
  }

  async function getSession() {
    const auth = client()?.auth;
    if (!auth?.getSession) return null;
    const { data, error } = await auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function refresh(post, { force = false } = {}) {
    const reelId = reelIdFor(post);
    if (!reelId) return null;
    post.dataset.reelId = reelId;
    const cached = readCache(reelId);
    if (cached?.stats) apply(post, reelId, cached.stats);
    if (!force && cached && Date.now() - cached.updatedAt < CACHE_TTL) return cached.stats;

    const existing = requests.get(reelId);
    if (existing) {
      const result = await existing;
      if (result) apply(post, reelId, result);
      return result;
    }

    const task = (async () => {
      const session = await getSession().catch(() => null);
      const headers = { Accept: 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch(`${WORKER}/reels/${encodeURIComponent(reelId)}`, {
        method: 'GET', headers, cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.reel) throw new Error(payload?.error || 'تعذر تحديث إحصائيات الريل.');
      const stats = {
        likes_count: Math.max(0, Number(payload.reel.likes_count) || 0),
        comments_count: Math.max(0, Number(payload.reel.comments_count) || 0),
        shares_count: Math.max(0, Number(payload.reel.shares_count) || 0)
      };
      writeCache(reelId, stats);
      return stats;
    })();
    requests.set(reelId, task);
    try {
      const stats = await task;
      apply(post, reelId, stats);
      return stats;
    } catch (error) {
      // Retain the last known counters on network failure; never replace them with zero.
      if (!cached) console.warn('[EgyBook Reels Stats] refresh failed:', error?.message || error);
      return cached?.stats || null;
    } finally {
      if (requests.get(reelId) === task) requests.delete(reelId);
    }
  }

  async function recordShare(reelId, post) {
    const id = String(reelId || reelIdFor(post) || '').trim();
    if (!/^\d+$/.test(id) || Number(id) < 1) throw new Error('تعذر تحديد الريل المراد مشاركته.');
    const session = await getSession();
    if (!session?.access_token) throw new Error('سجّل الدخول لتسجيل المشاركة.');
    const eventId = (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
      `share-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const response = await fetch(`${WORKER}/reels/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ event_id: eventId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'تعذر تحديث عداد المشاركة.');
    const cached = readCache(id)?.stats || {};
    const stats = { ...cached, shares_count: Math.max(0, Number(payload.shares_count) || 0) };
    writeCache(id, stats);
    if (post) apply(post, id, stats);
    return payload;
  }

  window.EgyBookReelsStats = {
    refresh,
    restore(post) {
      const id = reelIdFor(post);
      if (!id) return false;
      post.dataset.reelId = id;
      const cached = readCache(id);
      if (!cached?.stats) return false;
      apply(post, id, cached.stats);
      return true;
    },
    recordShare
  };

  window.addEventListener('egybook:evp-post-context', event => {
    activePost = event.detail?.post || null;
    if (activePost) {
      window.EgyBookReelsStats.restore(activePost);
      void refresh(activePost);
    }
  });
  document.addEventListener('egybook:reels-comments-open', event => {
    const post = event.detail?.post;
    if (post) window.EgyBookReelsStats.restore(post);
  });
  document.addEventListener('egybook:reels-comments-count-updated', event => {
    const reelId = String(event.detail?.reelId || '');
    const count = Number(event.detail?.totalCount);
    if (!/^\d+$/.test(reelId) || !Number.isFinite(count) || count < 0) return;
    const previous = readCache(reelId)?.stats || {};
    const stats = { ...previous, comments_count: count };
    writeCache(reelId, stats);
    const post = event.detail?.post || activePost;
    if (post && reelIdFor(post) === reelId) apply(post, reelId, stats);
  });
  document.addEventListener('egybook:reels-comments-resolved', event => {
    const post = event.detail?.post;
    const reelId = String(event.detail?.reelId || '');
    if (post && /^\d+$/.test(reelId)) {
      post.dataset.reelId = reelId;
      void refresh(post);
    }
  });
})();
