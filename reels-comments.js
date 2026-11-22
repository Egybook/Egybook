/* EgyBook Reels Comments V220 Phase 1.
   Neon-backed comments with account-scoped stale-while-revalidate caching,
   request de-duplication, and the Reels-only compact action sheet. */
(() => {
  'use strict';
  if (window.__egybookReelsCommentsInstalled) return;
  window.__egybookReelsCommentsInstalled = true;

  const WORKER = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev';
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = {
    active: false, post: null, postId: '', reelId: null, reelOwnerId: '', user: null,
    comments: [], profiles: {}, reactions: [], commentIndex: new Map(),
    offset: 0, hasMore: false, totalCount: null, sort: 'relevant', parentId: null,
    loading: false, refreshPending: false, generation: 0, pendingOpen: null, activeAction: null
  };

  const modal = () => $('#commentsModal');
  const list = () => $('#commentsList');
  const input = () => $('#commentInput');
  const supabase = () => window.__egybookSupabaseClient;
  const actionBackdrop = () => $('#commentActionsBackdrop');
  const editBackdrop = () => $('#commentEditBackdrop');
  const deleteBackdrop = () => $('#commentDeleteBackdrop');

  function notify(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function auth() {
    const client = supabase();
    if (!client) throw new Error('تعذر الاتصال بحسابك.');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    if (!session?.access_token || !session.user?.id) throw new Error('سجّل الدخول أولاً.');
    state.user = session.user;
    return session;
  }

  async function api(path, options = {}) {
    const session = await auth();
    const response = await fetch(WORKER + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'تعذر تنفيذ العملية.');
    return payload;
  }

  function setStatus(message = '') {
    const host = list();
    if (!host) return;
    let status = $('#reelsNeonCommentsStatus', host);
    if (!status) {
      status = document.createElement('p');
      status.id = 'reelsNeonCommentsStatus';
      status.className = 'comments-empty';
      status.setAttribute('role', 'status');
      host.append(status);
    }
    status.textContent = message;
    status.hidden = !message;
  }

  // Cache comment payloads and profiles per signed-in account. The cache is
  // only a fast display snapshot; Neon remains the source of truth.
  const COMMENT_CACHE_PREFIX = 'egybook:reel-comments:v220:';
  const COMMENT_CACHE_FRESH_MS = 25_000;
  const COMMENT_CACHE_MAX_AGE_MS = 5 * 60_000;
  const COMMENT_CACHE_MAX_CHARS = 220_000;
  const commentMemoryCache = new Map();
  const commentRequests = new Map();
  const profileMemoryCache = new Map();
  const profileRequests = new Map();
  const reelOwnerMemoryCache = new Map();

  function accountKey() { return String(state.user?.id || 'guest'); }
  function commentCacheKey(reelId, sort = state.sort) {
    return `${COMMENT_CACHE_PREFIX}${accountKey()}:${String(reelId)}:${sort}`;
  }
  function readCommentCache(reelId, sort = state.sort) {
    const key = commentCacheKey(reelId, sort);
    const memory = commentMemoryCache.get(key);
    if (memory && Date.now() - memory.updatedAt <= COMMENT_CACHE_MAX_AGE_MS) return memory;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved?.version === 1 && Date.now() - Number(saved.updatedAt || 0) <= COMMENT_CACHE_MAX_AGE_MS) {
        commentMemoryCache.set(key, saved);
        return saved;
      }
    } catch (_) {}
    return null;
  }
  function saveCommentCache(reelId = state.reelId) {
    if (!reelId || !state.user?.id) return;
    const entry = {
      version: 1, updatedAt: Date.now(), sort: state.sort,
      comments: state.comments, reactions: state.reactions, profiles: state.profiles,
      offset: state.offset, hasMore: state.hasMore, totalCount: state.totalCount
    };
    const key = commentCacheKey(reelId, state.sort);
    commentMemoryCache.set(key, entry);
    while (commentMemoryCache.size > 40) commentMemoryCache.delete(commentMemoryCache.keys().next().value);
    try {
      const serialized = JSON.stringify(entry);
      if (serialized.length <= COMMENT_CACHE_MAX_CHARS) sessionStorage.setItem(key, serialized);
    } catch (_) { /* Storage can be full or unavailable; in-memory cache still works. */ }
  }
  function restoreCommentCache(reelId = state.reelId) {
    const cached = readCommentCache(reelId, state.sort);
    if (!cached) return null;
    state.comments = Array.isArray(cached.comments) ? cached.comments : [];
    state.reactions = Array.isArray(cached.reactions) ? cached.reactions : [];
    state.profiles = cached.profiles && typeof cached.profiles === 'object' ? cached.profiles : {};
    state.offset = Math.max(0, Number(cached.offset) || 0);
    state.hasMore = !!cached.hasMore;
    state.totalCount = cached.totalCount !== null && cached.totalCount !== undefined && Number.isFinite(Number(cached.totalCount))
      ? Number(cached.totalCount) : null;
    render();
    setStatus('');
    return cached;
  }
  function profileCacheKey(userId) { return `egybook:reel-profile:v220:${accountKey()}:${String(userId)}`; }
  function getCachedProfile(userId) {
    const key = profileCacheKey(userId);
    const memory = profileMemoryCache.get(key);
    if (memory && Date.now() - memory.updatedAt < 10 * 60_000) return memory.profile;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved?.profile && Date.now() - Number(saved.updatedAt || 0) < 10 * 60_000) {
        profileMemoryCache.set(key, saved);
        return saved.profile;
      }
    } catch (_) {}
    return null;
  }
  function setCachedProfile(userId, profile) {
    const key = profileCacheKey(userId);
    const value = { updatedAt: Date.now(), profile };
    profileMemoryCache.set(key, value);
    while (profileMemoryCache.size > 250) profileMemoryCache.delete(profileMemoryCache.keys().next().value);
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  async function hydrateProfiles(ids, reelId, generation) {
    const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
    uniqueIds.forEach(id => {
      const cached = getCachedProfile(id);
      if (cached) state.profiles[id] = cached;
    });
    const missing = uniqueIds.filter(id => !state.profiles[id]);
    if (!missing.length || !supabase()) return;
    const account = accountKey();
    const requestKey = `${account}:${missing.slice().sort().join(',')}`;
    let request = profileRequests.get(requestKey);
    if (!request) {
      request = supabase().from('profiles').select('id,full_name,username,avatar_url').in('id', missing)
        .then(({ data, error }) => {
          if (error) throw error;
          const rows = data || [];
          rows.forEach(profile => setCachedProfile(profile.id, profile));
          return rows;
        });
      profileRequests.set(requestKey, request);
      request.finally(() => { if (profileRequests.get(requestKey) === request) profileRequests.delete(requestKey); }).catch(() => {});
    }
    try {
      const rows = await request;
      if (account !== accountKey() || reelId !== state.reelId || !state.active) return;
      rows.forEach(profile => { state.profiles[profile.id] = profile; });
    } catch (error) {
      // Keep cached/fallback names; a profile lookup must not hide comments.
      console.warn('[EgyBook Reels Comments] profile hydration failed:', error?.message || error);
    }
  }

  async function resolveReel(detail, generation) {
    const post = detail.post || state.post;
    const postId = String(detail.postId || post?.dataset.postId || '').trim();
    const knownReelId = Number(detail.reelId || post?.dataset.reelId || 0);
    if (Number.isSafeInteger(knownReelId) && knownReelId > 0) {
      await auth();
      if (generation !== state.generation || !state.active) return;
      state.postId = postId;
      state.reelId = knownReelId;
      if (post) post.dataset.reelId = String(knownReelId);
      // Only trust a previously verified Reel owner, not a generic post author
      // attribute (a post can be a share/repost of someone else's Reel).
      const ownerFromPost = String(post?.dataset.reelOwnerId || '');
      const cachedOwner = reelOwnerMemoryCache.get(`${accountKey()}:${knownReelId}`) || '';
      state.reelOwnerId = cachedOwner || ownerFromPost;
      if (state.reelOwnerId) reelOwnerMemoryCache.set(`${accountKey()}:${knownReelId}`, state.reelOwnerId);
      if (!state.reelOwnerId) {
        try {
          const result = await api(`/reels/${state.reelId}`);
          if (generation === state.generation) {
            state.reelOwnerId = String(result?.reel?.user_id || '');
            if (state.reelOwnerId) reelOwnerMemoryCache.set(`${accountKey()}:${knownReelId}`, state.reelOwnerId);
          }
        } catch (_) { /* The comments still work if owner metadata is unavailable. */ }
      }
      return;
    }

    let videoUrl = detail.videoUrl || '';
    if (!videoUrl) {
      const video = post?.querySelector('video');
      videoUrl = video?.currentSrc || video?.src || post?.dataset.mediaUrl || post?.dataset.videoUrl || '';
    }
    if (!postId || !videoUrl) throw new Error('تعذر تحديد الفيديو الحالي لربط تعليقاته.');
    const caption = post?.querySelector('.post-text,.post-caption')?.textContent?.trim() || '';
    const thumbnailUrl = post?.querySelector('video')?.poster || post?.querySelector('img.post-image')?.src || '';
    const linked = await api(`/reels/by-post/${encodeURIComponent(postId)}`, {
      method: 'POST',
      body: JSON.stringify({ video_url: videoUrl, caption, thumbnail_url: thumbnailUrl })
    });
    if (!linked?.reel?.id) throw new Error('تعذر ربط الريل بالتعليقات.');
    if (generation !== state.generation || !state.active) return;
    state.postId = postId;
    state.reelId = Number(linked.reel.id);
    if (post) post.dataset.reelId = String(state.reelId);
    state.reelOwnerId = String(linked.reel.user_id || post?.dataset.userId || post?.dataset.ownerId || '');
    if (state.reelOwnerId) reelOwnerMemoryCache.set(`${accountKey()}:${state.reelId}`, state.reelOwnerId);
  }

  function buildTree(flatRows) {
    const byId = new Map();
    (flatRows || []).forEach(comment => {
      byId.set(String(comment.id), { ...comment, replies: [] });
    });
    const roots = [];
    byId.forEach(comment => {
      const parentId = comment.parent_comment_id == null ? '' : String(comment.parent_comment_id);
      const parent = parentId ? byId.get(parentId) : null;
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
    });
    const byCreated = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || Number(a.id) - Number(b.id);
    const sortReplies = node => {
      node.replies.sort(byCreated);
      node.replies.forEach(sortReplies);
    };
    roots.forEach(sortReplies);
    state.commentIndex = byId;
    return roots;
  }

  function countComments(nodes) {
    return (nodes || []).reduce((count, comment) => count + 1 + countComments(comment.replies), 0);
  }

  function countReplies(comment) {
    return countComments(comment?.replies || []);
  }

  function formatTime(value) {
    try { return new Date(value).toLocaleString('ar-EG'); }
    catch (_) { return 'الآن'; }
  }

  function commentReactions(commentId) {
    return state.reactions.filter(item => String(item.comment_id) === String(commentId));
  }

  function currentReaction(commentId) {
    return commentReactions(commentId).find(item => String(item.user_id) === String(state.user?.id || ''))?.reaction || null;
  }

  function makeCommentRow(comment, depth) {
    const profile = state.profiles[comment.user_id] || {};
    const nameText = profile.full_name || profile.username || 'عضو EgyBook';
    const avatarUrl = String(profile.avatar_url || '').trim();
    const row = document.createElement('article');
    row.className = 'egy-comment' + (depth ? ' egy-comment-reply' : '');
    row.dataset.commentId = String(comment.id);
    row.style.setProperty('--reply-depth', String(Math.min(depth, 3)));
    row.dataset.ownComment = String(comment.user_id) === String(state.user?.id || '') ? 'true' : 'false';

    const main = document.createElement('div'); main.className = 'egy-comment-main';
    const meta = document.createElement('div'); meta.className = 'egy-comment-meta';
    const name = document.createElement('strong'); name.className = 'egy-comment-name'; name.textContent = nameText;
    const time = document.createElement('span'); time.textContent = `· ${formatTime(comment.created_at)}`;
    meta.append(name, time);
    const body = document.createElement('div'); body.className = 'egy-comment-text';
    body.textContent = comment.comment_text || '';
    if (comment.edited_at) {
      const edited = document.createElement('small'); edited.className = 'comment-edited-label'; edited.textContent = 'تم التعديل';
      body.append(document.createTextNode(' '), edited);
    }

    const actions = document.createElement('div'); actions.className = 'egy-comment-actions';
    const reply = document.createElement('button');
    reply.type = 'button'; reply.className = 'reply'; reply.dataset.action = 'comment-reply'; reply.textContent = 'رد';
    actions.append(reply);
    main.append(meta, body, actions);

    const avatar = document.createElement('span'); avatar.className = 'egy-comment-avatar';
    if (avatarUrl) {
      avatar.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
      avatar.classList.add('has-avatar-image');
    } else avatar.textContent = nameText.trim().slice(0, 1) || 'ع';

    const votes = document.createElement('div'); votes.className = 'egy-comment-votes';
    const myReaction = currentReaction(comment.id);
    [['👎', 'dislike', '👎'], ['👍', 'like', '👍']].forEach(([label, type, rendered]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comment-vote' + ((myReaction === rendered) ? ' active' : '');
      button.textContent = myReaction === rendered ? rendered : label;
      button.dataset.action = 'comment-vote';
      button.dataset.vote = type;
      button.setAttribute('aria-label', type === 'like' ? 'إعجاب بالتعليق' : 'عدم الإعجاب بالتعليق');
      votes.append(button);
    });

    const grouped = new Map();
    commentReactions(comment.id).forEach(item => grouped.set(item.reaction, (grouped.get(item.reaction) || 0) + 1));
    const summary = document.createElement('div'); summary.className = 'comment-reaction-counts';
    grouped.forEach((count, emoji) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'comment-reaction-count';
      chip.dataset.action = 'comment-reactions-open'; chip.dataset.commentId = String(comment.id);
      chip.textContent = `${emoji} ${count}`; chip.setAttribute('aria-label', `عرض ${count} تفاعل`);
      summary.append(chip);
    });
    if (!summary.childElementCount) {
      const empty = document.createElement('span'); empty.className = 'comment-reaction-empty'; empty.textContent = '';
      summary.append(empty);
    }
    votes.append(summary);
    row.append(main, avatar, votes);

    if (comment.replies?.length) {
      const replies = document.createElement('div'); replies.className = 'comment-replies'; replies.hidden = true;
      comment.replies.forEach(child => replies.append(renderComment(child, depth + 1)));
      const total = countReplies(comment);
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'comment-replies-toggle';
      toggle.dataset.action = 'comment-replies-toggle'; toggle.setAttribute('aria-expanded', 'false');
      const updateLabel = () => {
        const expanded = !replies.hidden;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? 'إخفاء الردود ▲' : `إظهار الردود (${total}) ▼`;
      };
      updateLabel();
      toggle.addEventListener('click', () => { replies.hidden = !replies.hidden; updateLabel(); });
      row.append(toggle, replies);
    }

    bindCommentLongPress(row, comment);
    return row;
  }

  function renderComment(comment, depth = 0) { return makeCommentRow(comment, depth); }

  function bindCommentLongPress(row, comment) {
    row.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      if (event.target.closest('button, a, input, textarea')) return;
      if (event.target.closest('.egy-comment') !== row) return;
      openReelCommentActions(comment, row);
    });
    row.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('button, a, input, textarea, audio')) return;
      if (event.target.closest('.egy-comment') !== row) return;
      row._reelPressStart = { x: event.clientX, y: event.clientY };
      row._reelLongPressFired = false;
      clearTimeout(row._reelLongPressTimer);
      row._reelLongPressTimer = setTimeout(() => {
        row._reelLongPressFired = true;
        openReelCommentActions(comment, row);
      }, 520);
    }, { passive: true });
    row.addEventListener('pointermove', event => {
      const start = row._reelPressStart;
      if (start && (Math.abs(event.clientX - start.x) > 12 || Math.abs(event.clientY - start.y) > 12)) {
        clearTimeout(row._reelLongPressTimer);
      }
    }, { passive: true });
    row.addEventListener('click', event => {
      if (!row._reelLongPressFired) return;
      event.preventDefault(); event.stopPropagation();
      row._reelLongPressFired = false;
    }, true);
    ['pointerup', 'pointerleave', 'pointercancel', 'scroll'].forEach(type => {
      row.addEventListener(type, () => {
        clearTimeout(row._reelLongPressTimer);
        row._reelPressStart = null;
      }, { passive: true });
    });
  }

  function render() {
    const host = list();
    if (!host) return;
    host.replaceChildren();
    const roots = buildTree(state.comments);
    if (!roots.length) {
      const empty = document.createElement('p'); empty.className = 'comments-empty';
      empty.textContent = 'كن أول من يعلّق على هذا الريل.'; host.append(empty);
    } else {
      const fragment = document.createDocumentFragment();
      roots.forEach(comment => fragment.append(renderComment(comment, 0)));
      host.append(fragment);
    }
    const count = $('#commentsCount');
    if (count) count.textContent = `${Number.isFinite(state.totalCount) ? state.totalCount : countComments(roots)} تعليق`;
    if (state.hasMore) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'comment-replies-toggle';
      more.dataset.reelsCommentsMore = 'true'; more.textContent = 'عرض المزيد من التعليقات';
      host.append(more);
    }
  }

  async function load(reset = true, { force = false } = {}) {
    if (!state.reelId) return;
    if (state.loading) { if (reset) state.refreshPending = true; return; }
    const generation = state.generation;
    const requestedReelId = state.reelId;
    const account = accountKey();
    const cached = readCommentCache(requestedReelId, state.sort);
    if (reset && !force && cached && Date.now() - cached.updatedAt < COMMENT_CACHE_FRESH_MS) {
      if (!state.comments.length) restoreCommentCache(requestedReelId);
      return;
    }

    state.loading = true;
    const previousComments = state.comments;
    const previousOffset = state.offset;
    const previousHasMore = state.hasMore;
    if (reset) state.offset = 0;
    // Keep the last rendered data on screen while stale data is revalidated.
    if (!previousComments.length) setStatus('جارٍ تحميل التعليقات…');
    else setStatus('');
    const requestOffset = state.offset;
    const requestPath = `/reels/${requestedReelId}/comments?limit=25&offset=${requestOffset}&sort=${encodeURIComponent(state.sort)}`;
    const requestKey = `${account}:${requestPath}`;
    try {
      let request = commentRequests.get(requestKey);
      if (!request) {
        request = api(requestPath);
        commentRequests.set(requestKey, request);
        request.finally(() => { if (commentRequests.get(requestKey) === request) commentRequests.delete(requestKey); }).catch(() => {});
      }
      const data = await request;
      if (generation !== state.generation || !state.active || requestedReelId !== state.reelId || account !== accountKey()) return;
      const rows = Array.isArray(data.comments) ? data.comments : [];
      if (reset) state.comments = rows;
      else {
        const merged = new Map(state.comments.map(comment => [String(comment.id), comment]));
        rows.forEach(comment => merged.set(String(comment.id), comment));
        state.comments = Array.from(merged.values());
      }
      state.offset = requestOffset + Number(data.roots_count ?? rows.filter(row => row.parent_comment_id == null).length);
      state.hasMore = !!data.has_more;
      if (data.total_count !== null && data.total_count !== undefined && Number.isFinite(Number(data.total_count))) {
        state.totalCount = Number(data.total_count);
      }
      const incomingReactions = Array.isArray(data.reactions) ? data.reactions : [];
      if (reset) state.reactions = incomingReactions;
      else {
        const mergedReactions = new Map(state.reactions.map(item => [`${item.comment_id}:${item.user_id}`, item]));
        incomingReactions.forEach(item => mergedReactions.set(`${item.comment_id}:${item.user_id}`, item));
        state.reactions = Array.from(mergedReactions.values());
      }

      const ids = [...new Set([
        ...state.comments.map(comment => comment.user_id),
        ...state.reactions.map(reaction => reaction.user_id)
      ].filter(Boolean))];
      await hydrateProfiles(ids, requestedReelId, generation);
      if (generation !== state.generation || !state.active || requestedReelId !== state.reelId || account !== accountKey()) return;
      render();
      setStatus('');
      saveCommentCache(requestedReelId);
      document.dispatchEvent(new CustomEvent('egybook:reels-comments-count-updated', {
        detail: { post: state.post, reelId: requestedReelId, totalCount: state.totalCount }
      }));
    } catch (error) {
      if (generation !== state.generation || !state.active || requestedReelId !== state.reelId || account !== accountKey()) return;
      // Preserve already-rendered comments and pagination position if a refresh fails.
      if (reset) { state.offset = previousOffset; state.hasMore = previousHasMore; }
      if (!previousComments.length) setStatus(error.message || 'تعذر تحميل التعليقات.');
      else { render(); notify(error.message || 'تعذر تحديث التعليقات.'); }
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        if (state.refreshPending && state.active && state.reelId) {
          state.refreshPending = false;
          queueMicrotask(() => { void load(true, { force: true }); });
        }
      }
    }
  }

  function focusNativeComposer() {
    const field = input();
    if (!field) return;
    requestAnimationFrame(() => {
      try { field.focus({ preventScroll: true }); } catch (_) { field.focus(); }
      try { field.setSelectionRange(field.value.length, field.value.length); } catch (_) {}
    });
  }

  function hideMenu() {
    const backdrop = actionBackdrop();
    if (!backdrop) return;
    backdrop.classList.remove('visible');
    setTimeout(() => {
      if (!backdrop.classList.contains('visible')) {
        backdrop.hidden = true;
        backdrop.classList.remove('evp-comment-actions-compact', 'evp-reels-comment-actions');
      }
    }, 190);
  }

  function closeLayers(clearActive = true) {
    const backdrop = actionBackdrop();
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.classList.remove('visible', 'evp-comment-actions-compact', 'evp-reels-comment-actions');
    }
    [editBackdrop(), deleteBackdrop()].forEach(layer => {
      if (layer) { layer.hidden = true; layer.classList.remove('visible'); }
    });
    const reactions = $('#commentReactionsModal');
    if (reactions) { reactions.hidden = true; reactions.classList.remove('open'); }
    if (clearActive) state.activeAction = null;
  }

  function openReelCommentActions(comment, row) {
    if (!state.active || !comment || !row) return;
    const backdrop = actionBackdrop();
    if (!backdrop) return;
    closeLayers(false);
    state.activeAction = { comment, row };
    const mine = String(comment.user_id) === String(state.user?.id || '');
    const reelOwner = !!state.reelOwnerId && String(state.reelOwnerId) === String(state.user?.id || '');
    const option = name => $(`[data-comment-sheet-action="${name}"]`, backdrop);
    const edit = option('edit'), remove = option('delete'), report = option('report');
    const hide = option('hide'), share = option('share');
    if (edit) edit.hidden = !mine;
    if (remove) remove.hidden = !(mine || reelOwner);
    // Preserve the original compact video-comments menu behavior. A Reels
    // report action is not shown until a Neon report endpoint exists.
    if (report) report.hidden = true;
    if (hide) hide.hidden = true;
    if (share) share.hidden = true;
    // The Neon migration now supports the same reaction set as Home comments.
    backdrop.classList.add('evp-comment-actions-compact', 'evp-reels-comment-actions');
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('visible'));
  }

  async function toggleReaction(comment, reaction) {
    const reelId = state.reelId, generation = state.generation;
    const existing = currentReaction(comment.id);
    const method = existing === reaction ? 'DELETE' : 'POST';
    const options = { method };
    if (method === 'POST') options.body = JSON.stringify({ reaction });
    await api(`/reels/${reelId}/comments/${encodeURIComponent(comment.id)}/reactions`, options);
    if (generation === state.generation && state.active && reelId === state.reelId) await load(true, { force: true });
  }

  function openReactionDetails(commentId) {
    const modalNode = $('#commentReactionsModal');
    const listNode = $('#commentReactionsList');
    const title = $('#commentReactionsTitle');
    if (!modalNode || !listNode) return;
    const rows = commentReactions(commentId);
    listNode.replaceChildren();
    if (title) title.textContent = 'التفاعلات على التعليق أو الرد';
    if (!rows.length) {
      const empty = document.createElement('p'); empty.className = 'comment-reactions-status';
      empty.textContent = 'لا توجد تفاعلات حتى الآن.'; listNode.append(empty);
    } else {
      rows.forEach(reaction => {
        const profile = state.profiles[reaction.user_id] || {};
        const item = document.createElement('div'); item.className = 'comment-reaction-person';
        const avatar = document.createElement('span'); avatar.className = 'comment-reaction-person-avatar';
        if (profile.avatar_url) {
          avatar.style.backgroundImage = `url("${String(profile.avatar_url).replace(/"/g, '%22')}")`;
          avatar.classList.add('has-image');
        } else avatar.textContent = (profile.full_name || profile.username || 'ع').slice(0, 1);
        const name = document.createElement('span'); name.className = 'comment-reaction-person-name';
        name.textContent = profile.full_name || profile.username || 'عضو EgyBook';
        const emoji = document.createElement('span'); emoji.className = 'comment-reaction-person-emoji'; emoji.textContent = reaction.reaction || '👍';
        item.append(avatar, name, emoji); listNode.append(item);
      });
    }
    modalNode.hidden = false; modalNode.classList.add('open');
  }

  async function submitComment() {
    const field = input();
    const reelId = state.reelId, generation = state.generation;
    const text = String(field?.value || '').normalize('NFC').trim();
    if (!text || !reelId) return;
    const submit = $('#commentForm button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await api(`/reels/${reelId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment_text: text, parent_comment_id: state.parentId })
      });
      if (generation !== state.generation || !state.active || reelId !== state.reelId) return;
      if (field) { field.value = ''; field.placeholder = 'اكتب تعليقًا...'; delete field.dataset.replyingTo; }
      state.parentId = null;
      await load(true, { force: true });
    } catch (error) { notify(error.message || 'تعذر إرسال التعليق.'); }
    finally { if (submit) submit.disabled = false; }
  }

  async function saveEdit() {
    const active = state.activeAction;
    const reelId = state.reelId, generation = state.generation;
    const text = String($('#commentEditInput')?.value || '').normalize('NFC').trim();
    if (!active || !text) { notify('اكتب نصًا قبل الحفظ.'); return; }
    if (String(active.comment.user_id) !== String(state.user?.id || '')) { notify('يمكنك تعديل تعليقاتك وردودك فقط.'); return; }
    const button = $('[data-comment-edit-action="save"]', editBackdrop() || document);
    if (button) button.disabled = true;
    try {
      await api(`/reels/${reelId}/comments/${encodeURIComponent(active.comment.id)}`, {
        method: 'PATCH', body: JSON.stringify({ comment_text: text })
      });
      if (generation !== state.generation || !state.active || reelId !== state.reelId) return;
      closeLayers(true);
      await load(true, { force: true });
      notify('تم حفظ التعديلات.');
    } catch (error) { notify(error.message || 'تعذر حفظ التعديل.'); }
    finally { if (button) button.disabled = false; }
  }

  async function confirmDelete() {
    const active = state.activeAction;
    if (!active) return;
    const reelId = state.reelId, generation = state.generation;
    const button = $('[data-comment-delete-action="confirm"]', deleteBackdrop() || document);
    if (button) button.disabled = true;
    try {
      await api(`/reels/${reelId}/comments/${encodeURIComponent(active.comment.id)}`, { method: 'DELETE' });
      if (generation !== state.generation || !state.active || reelId !== state.reelId) return;
      closeLayers(true);
      await load(true, { force: true });
      notify(active.comment.parent_comment_id ? 'تم حذف الرد.' : 'تم حذف التعليق.');
    } catch (error) { notify(error.message || 'تعذر حذف التعليق.'); }
    finally { if (button) button.disabled = false; }
  }

  async function handleMenuAction(action, button) {
    const active = state.activeAction;
    if (!active) return;
    const { comment, row } = active;
    if (action === 'close') { hideMenu(); state.activeAction = null; return; }
    if (action === 'react') {
      const reaction = button.dataset.reaction;
      hideMenu();
      try { await toggleReaction(comment, reaction); }
      catch (error) { notify(error.message || 'تعذر حفظ التفاعل.'); }
      return;
    }
    if (action === 'reply') {
      hideMenu(); state.parentId = String(comment.id);
      const field = input();
      if (field) { field.placeholder = 'اكتب ردك...'; field.dataset.replyingTo = String(comment.id); }
      focusNativeComposer();
      return;
    }
    if (action === 'copy') {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(String(comment.comment_text || ''));
        notify('تم نسخ نص التعليق.');
      } catch (_) { notify('تعذر النسخ تلقائيًا على هذا المتصفح.'); }
      hideMenu(); return;
    }
    if (action === 'share') {
      const text = String(comment.comment_text || '');
      try {
        if (navigator.share) await navigator.share({ text });
        else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); notify('تم نسخ النص للمشاركة.'); }
        else notify('المشاركة غير مدعومة في هذا المتصفح.');
      } catch (_) { /* User cancelled the native share sheet. */ }
      hideMenu(); return;
    }
    if (action === 'hide') {
      if (row) row.hidden = true;
      hideMenu(); state.activeAction = null; notify('تم إخفاء التعليق من العرض الحالي.'); return;
    }
    if (action === 'edit') {
      if (String(comment.user_id) !== String(state.user?.id || '')) { notify('يمكنك تعديل تعليقاتك وردودك فقط.'); return; }
      const field = $('#commentEditInput');
      if (field) field.value = String(comment.comment_text || '');
      hideMenu();
      const layer = editBackdrop();
      if (layer) {
        layer.hidden = false;
        requestAnimationFrame(() => { layer.classList.add('visible'); $('#commentEditInput')?.focus({ preventScroll: true }); });
      }
      return;
    }
    if (action === 'delete') {
      const mine = String(comment.user_id) === String(state.user?.id || '');
      const owner = String(state.reelOwnerId || '') === String(state.user?.id || '');
      if (!mine && !owner) { notify('لا تملك صلاحية حذف هذا التعليق.'); return; }
      hideMenu();
      const layer = deleteBackdrop();
      const title = layer?.querySelector('h3');
      if (title) title.textContent = comment.parent_comment_id ? 'هل تريد بالتأكيد حذف هذا الرد؟' : 'هل تريد بالتأكيد حذف هذا التعليق؟';
      if (layer) { layer.hidden = false; requestAnimationFrame(() => layer.classList.add('visible')); }
    }
  }

  function closeReactionDetails() {
    const node = $('#commentReactionsModal');
    if (node) { node.hidden = true; node.classList.remove('open'); }
  }

  function onWindowClick(event) {
    if (!state.active) return;
    const target = event.target;
    const stop = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };

    const menu = target.closest?.('#commentActionsBackdrop');
    if (menu && !menu.hidden) {
      if (target === menu) { stop(); hideMenu(); state.activeAction = null; return; }
      const option = target.closest('[data-comment-sheet-action]');
      if (option) { stop(); void handleMenuAction(option.dataset.commentSheetAction, option); return; }
    }

    const editLayer = target.closest?.('#commentEditBackdrop');
    if (editLayer && !editLayer.hidden) {
      const button = target.closest('[data-comment-edit-action]');
      if (button) {
        stop();
        if (button.dataset.commentEditAction === 'close') closeLayers(true);
        else if (button.dataset.commentEditAction === 'save') void saveEdit();
        return;
      }
      if (target === editLayer) { stop(); closeLayers(true); return; }
    }

    const deleteLayer = target.closest?.('#commentDeleteBackdrop');
    if (deleteLayer && !deleteLayer.hidden) {
      const button = target.closest('[data-comment-delete-action]');
      if (button) {
        stop();
        if (button.dataset.commentDeleteAction === 'close') closeLayers(true);
        else if (button.dataset.commentDeleteAction === 'confirm') void confirmDelete();
        return;
      }
      if (target === deleteLayer) { stop(); closeLayers(true); return; }
    }

    const reactionModal = target.closest?.('#commentReactionsModal');
    if (reactionModal && !reactionModal.hidden) {
      if (target === reactionModal || target.closest('#commentReactionsClose')) { stop(); closeReactionDetails(); return; }
    }

    const sortOption = target.closest?.('#commentsSortMenu [data-action="sort-comments"]');
    if (sortOption) {
      stop();
      state.sort = sortOption.dataset.sort === 'relevant' ? 'relevant' : 'recent';
      const menuNode = $('#commentsSortMenu'); if (menuNode) menuNode.hidden = true;
      const button = $('#commentsSortButton');
      const label = button?.querySelector('span');
      if (label) label.textContent = sortOption.querySelector('span')?.textContent || sortOption.textContent.trim();
      void load(true, { force: true }); return;
    }

    const more = target.closest?.('#commentsList [data-reels-comments-more]');
    if (more) { stop(); void load(false); return; }

    const button = target.closest?.('#commentsList [data-action]');
    if (button) {
      const row = button.closest('.egy-comment');
      const comment = row ? state.commentIndex.get(String(row.dataset.commentId)) : null;
      if (!comment) return;
      const action = button.dataset.action;
      if (action === 'comment-reply') {
        stop(); state.parentId = String(comment.id);
        const field = input();
        if (field) { field.placeholder = 'اكتب ردك...'; field.dataset.replyingTo = String(comment.id); }
        focusNativeComposer(); return;
      }
      if (action === 'comment-vote') {
        stop();
        const reaction = button.dataset.vote === 'dislike' ? '👎' : '👍';
        void toggleReaction(comment, reaction).catch(error => notify(error.message || 'تعذر حفظ التفاعل.'));
        return;
      }
      if (action === 'comment-reactions-open') {
        stop(); openReactionDetails(button.dataset.commentId || comment.id); return;
      }
    }
  }

  function onWindowSubmit(event) {
    if (!state.active || event.target?.id !== 'commentForm') return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    void submitComment();
  }

  function onWindowPointer(event) {
    if (!state.active || !event.target?.closest?.('#commentsList .egy-comment')) return;
    // The site's generic reaction-swipe gesture is for Supabase feed comments.
    // Reels uses its own menu and its own Neon reaction endpoint.
    if (event.target.closest('.comment-vote, .comment-reaction-count')) {
      event.stopPropagation(); event.stopImmediatePropagation();
    }
  }

  function onWindowKeydown(event) {
    if (!state.active || event.key !== 'Escape') return;
    const hasLayer = [actionBackdrop(), editBackdrop(), deleteBackdrop(), $('#commentReactionsModal')]
      .some(layer => layer && !layer.hidden);
    if (!hasLayer) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    closeLayers(true);
  }

  function clearMode() {
    state.generation += 1;
    closeLayers(true);
    state.active = false; state.post = null; state.postId = ''; state.reelId = null; state.reelOwnerId = '';
    state.comments = []; state.profiles = {}; state.reactions = []; state.commentIndex.clear();
    state.offset = 0; state.hasMore = false; state.totalCount = null; state.parentId = null; state.loading = false; state.refreshPending = false;
    state.pendingOpen = null;
    document.body.classList.remove('reels-comments-open');
    document.documentElement.classList.remove('reels-comments-open');
    const commentsModal = modal(); commentsModal?.classList.remove('reels-neon-comments');
    const field = input();
    if (field) { field.placeholder = 'اكتب تعليقًا...'; delete field.dataset.replyingTo; }
  }

  document.addEventListener('egybook:reels-comments-open', event => {
    const detail = event.detail || {};
    state.pendingOpen = detail;
    state.post = detail.post || null;
    state.active = true;
    if (state.post) state.post.dataset.egybookReelsNeonComments = 'true';
  });

  document.addEventListener('egybook:comments-panel-opened', event => {
    if (!state.pendingOpen) return;
    const detail = state.pendingOpen; state.pendingOpen = null;
    state.post = detail.post || state.post;
    state.active = true;
    const commentsModal = modal();
    commentsModal?.classList.add('reels-neon-comments');
    document.body.classList.add('reels-comments-open');
    document.documentElement.classList.add('reels-comments-open');
    const field = input(); if (field) { field.value = ''; field.placeholder = 'اكتب تعليقًا...'; delete field.dataset.replyingTo; }
    state.parentId = null; state.sort = 'relevant'; state.offset = 0;
    state.reelId = null; state.reelOwnerId = ''; state.loading = false; state.refreshPending = false;
    state.comments = []; state.profiles = {}; state.reactions = []; state.commentIndex.clear(); state.hasMore = false; state.totalCount = null;
    const generation = ++state.generation;
    setStatus('');
    void resolveReel(detail, generation).then(() => {
      if (generation !== state.generation || !state.active || !state.reelId) return;
      const cached = restoreCommentCache(state.reelId);
      if (!cached) setStatus('جارٍ تحميل التعليقات…');
      document.dispatchEvent(new CustomEvent('egybook:reels-comments-resolved', {
        detail: { post: state.post, reelId: state.reelId }
      }));
      void load(true);
    }).catch(error => { if (generation === state.generation && state.active) setStatus(error.message); });
  });

  // Window capture runs before the legacy document-level Supabase comment handlers.
  window.addEventListener('click', onWindowClick, true);
  window.addEventListener('submit', onWindowSubmit, true);
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(type => {
    window.addEventListener(type, onWindowPointer, true);
  });
  window.addEventListener('keydown', onWindowKeydown, true);

  const commentsModal = modal();
  if (commentsModal && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (state.active && (commentsModal.hidden || !commentsModal.classList.contains('open'))) clearMode();
    });
    observer.observe(commentsModal, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  const commentsList = list();
  commentsList?.addEventListener('scroll', () => {
    if (state.active && state.hasMore && !state.loading && commentsList.scrollTop + commentsList.clientHeight >= commentsList.scrollHeight - 180) void load(false);
  }, { passive: true });

  document.addEventListener('click', event => {
    const surface = event.target.closest('#egybookVideoPlayer, #egybookVideoPoster');
    if (!surface) return;
    const comments = modal();
    if (state.active && comments?.classList.contains('open') && comments.classList.contains('evp-comments-overlay')) {
      event.preventDefault(); event.stopImmediatePropagation();
      comments.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  }, true);
})();
