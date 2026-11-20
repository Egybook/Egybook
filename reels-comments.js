/* EgyBook Reels Comments data adapter.
   Uses the site's existing #commentsModal UI; this module owns Neon data only. */
(() => {
  'use strict';
  if (window.__egybookReelsCommentsInstalled) return;
  window.__egybookReelsCommentsInstalled = true;

  const WORKER = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev';
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = {
    active: false, post: null, postId: '', reelId: null, user: null,
    comments: [], profiles: {}, attachments: [], pendingAttachment: null, recorder: null, audioChunks: [], offset: 0, hasMore: false,
    sort: 'relevant', parentId: null, loading: false, pendingOpen: null
  };

  const modal = () => $('#commentsModal');
  const list = () => $('#commentsList');
  const input = () => $('#commentInput');
  const supabase = () => window.__egybookSupabaseClient;

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

  async function resolveReel(detail) {
    const post = detail.post || state.post;
    let videoUrl = detail.videoUrl || '';
    if (!videoUrl) {
      const video = post?.querySelector('video');
      videoUrl = video?.currentSrc || video?.src || post?.dataset.mediaUrl || post?.dataset.videoUrl || '';
    }
    const postId = String(detail.postId || post?.dataset.postId || '').trim();
    if (!postId || !videoUrl) throw new Error('تعذر تحديد الريل الحالي لربط تعليقاته.');
    const caption = post?.querySelector('.post-text,.post-caption')?.textContent?.trim() || '';
    const thumbnailUrl = post?.querySelector('video')?.poster || post?.querySelector('img.post-image')?.src || '';
    const linked = await api(`/reels/by-post/${encodeURIComponent(postId)}`, {
      method: 'POST',
      body: JSON.stringify({ video_url: videoUrl, caption, thumbnail_url: thumbnailUrl })
    });
    if (!linked?.reel?.id) throw new Error('تعذر ربط الريل بالتعليقات.');
    state.postId = postId;
    state.reelId = Number(linked.reel.id);
  }

  function flattenComments(rows) {
    const byParent = new Map();
    (rows || []).forEach(comment => {
      const parent = comment.parent_comment_id == null ? '' : String(comment.parent_comment_id);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(comment);
    });
    const result = [];
    const visit = (parentId, depth) => {
      (byParent.get(String(parentId ?? '')) || []).forEach(comment => {
        result.push({ comment, depth });
        visit(comment.id, depth + 1);
      });
    };
    visit('', 0);
    return result;
  }

  function countComments(rows) {
    return (rows || []).reduce((count, comment) => count + 1 + countComments(comment.replies), 0);
  }

  function formatTime(value) {
    try { return new Date(value).toLocaleString('ar-EG'); }
    catch (_) { return 'الآن'; }
  }

  function makeCommentRow(comment, depth, reactions) {
    const profile = state.profiles[comment.user_id] || {};
    const nameText = profile.full_name || profile.username || 'عضو EgyBook';
    const avatarUrl = String(profile.avatar_url || '').trim();
    const row = document.createElement('article');
    row.className = 'egy-comment' + (depth ? ' egy-comment-reply' : '');
    row.dataset.commentId = String(comment.id);
    row.style.setProperty('--reply-depth', String(Math.min(depth, 3)));

    const main = document.createElement('div'); main.className = 'egy-comment-main';
    const meta = document.createElement('div'); meta.className = 'egy-comment-meta';
    const name = document.createElement('strong'); name.className = 'egy-comment-name'; name.textContent = nameText;
    const time = document.createElement('span'); time.textContent = `· ${formatTime(comment.created_at)}`;
    meta.append(name, time);
    const body = document.createElement('div'); body.className = 'egy-comment-text'; body.textContent = comment.comment_text || '';
    if (comment.edited_at) {
      const edited = document.createElement('small'); edited.className = 'comment-edited-label'; edited.textContent = 'تم التعديل';
      body.append(document.createTextNode(' '), edited);
    }
    const media = state.attachments.filter(item => String(item.comment_id) === String(comment.id));
    media.forEach(item => {
      if (item.attachment_type === 'image') {
        const image = document.createElement('img'); image.className = 'reel-comment-attachment-image'; image.src = item.public_url; image.alt = 'صورة مرفقة بالتعليق'; image.loading = 'lazy'; body.append(image);
      } else if (item.attachment_type === 'audio') {
        const audio = document.createElement('audio'); audio.className = 'reel-comment-attachment-audio'; audio.controls = true; audio.preload = 'none'; audio.src = item.public_url; body.append(audio);
      }
    });
    const actions = document.createElement('div'); actions.className = 'egy-comment-actions';
    const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'reply'; reply.dataset.action = 'comment-reply'; reply.textContent = 'رد';
    actions.append(reply);
    main.append(meta, body, actions);

    const avatar = document.createElement('span'); avatar.className = 'egy-comment-avatar';
    if (avatarUrl) {
      avatar.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
      avatar.classList.add('has-avatar-image');
    } else avatar.textContent = nameText.trim().slice(0, 1) || 'ع';

    const votes = document.createElement('div'); votes.className = 'egy-comment-votes';
    const mine = String(comment.user_id) === String(state.user?.id);
    const myReaction = reactions.find(item => String(item.comment_id) === String(comment.id) && String(item.user_id) === String(state.user?.id));
    [['👎', 'dislike', '👎'], ['👍', 'like', myReaction?.reaction || '👍']].forEach(([label, type, rendered]) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'comment-vote' + ((myReaction && type === 'like') ? ' active' : '');
      button.textContent = rendered; button.dataset.action = 'comment-vote'; button.dataset.vote = type;
      button.setAttribute('aria-label', type === 'like' ? 'إعجاب بالتعليق' : 'عدم الإعجاب بالتعليق');
      votes.append(button);
    });
    const grouped = new Map();
    reactions.filter(item => String(item.comment_id) === String(comment.id)).forEach(item => grouped.set(item.reaction, (grouped.get(item.reaction) || 0) + 1));
    const summary = document.createElement('div'); summary.className = 'comment-reaction-counts';
    grouped.forEach((count, emoji) => {
      const chip = document.createElement('span'); chip.className = 'comment-reaction-count'; chip.textContent = `${emoji} ${count}`; summary.append(chip);
    });
    votes.append(summary);
    row.append(main, avatar, votes);
    if (mine) row.dataset.ownComment = 'true';
    row.addEventListener('contextmenu', event => event.preventDefault());
    return row;
  }

  function render(reactions = []) {
    const host = list();
    if (!host) return;
    host.replaceChildren();
    const flat = flattenComments(state.comments);
    if (!flat.length) {
      const empty = document.createElement('p'); empty.className = 'comments-empty';
      empty.textContent = 'كن أول من يعلّق على هذا الريل.'; host.append(empty);
    } else {
      const fragment = document.createDocumentFragment();
      flat.forEach(({ comment, depth }) => fragment.append(makeCommentRow(comment, depth, reactions)));
      host.append(fragment);
    }
    const count = $('#commentsCount');
    if (count) count.textContent = `${countComments(state.comments)} تعليق`;
    if (state.hasMore) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'comment-replies-toggle';
      more.dataset.reelsCommentsMore = 'true'; more.textContent = 'عرض المزيد من التعليقات'; host.append(more);
    }
  }

  async function load(reset = true) {
    if (state.loading || !state.reelId) return;
    state.loading = true;
    if (reset) { state.offset = 0; state.comments = []; }
    setStatus('جارٍ تحميل التعليقات…');
    try {
      const data = await api(`/reels/${state.reelId}/comments?limit=25&offset=${state.offset}&sort=${state.sort}`);
      const rows = data.comments || [];
      state.comments = reset ? rows : state.comments.concat(rows);
      state.offset += rows.length;
      state.hasMore = !!data.has_more;
      const ids = [...new Set(state.comments.map(comment => comment.user_id).filter(Boolean))];
      state.profiles = {};
      if (ids.length && supabase()) {
        const { data: profiles, error } = await supabase().from('profiles').select('id,full_name,username,avatar_url').in('id', ids);
        if (!error) (profiles || []).forEach(profile => { state.profiles[profile.id] = profile; });
      }
      state.attachments = data.attachments || [];
      render(data.reactions || []);
      setStatus('');
    } catch (error) {
      setStatus(error.message || 'تعذر تحميل التعليقات.');
    } finally { state.loading = false; }
  }

  function focusNativeComposer() {
    const field = input();
    if (!field) return;
    requestAnimationFrame(() => {
      try { field.focus({ preventScroll: true }); } catch (_) { field.focus(); }
      try { field.setSelectionRange(field.value.length, field.value.length); } catch (_) {}
    });
  }

  function handleNativeClick(event) {
    if (!state.active) return;
    const more = event.target.closest('[data-reels-comments-more]');
    if (more) { event.preventDefault(); event.stopImmediatePropagation(); void load(false); return; }
    const button = event.target.closest('#commentsList [data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const row = button.closest('.egy-comment');
    if (!row) return;
    const id = row.dataset.commentId;
    if (action === 'comment-reply') {
      event.preventDefault(); event.stopImmediatePropagation();
      state.parentId = id;
      const field = input();
      if (field) { field.placeholder = 'اكتب ردك...'; field.dataset.replyingTo = id; }
      focusNativeComposer();
    } else if (action === 'comment-vote') {
      event.preventDefault(); event.stopImmediatePropagation();
      const reaction = button.dataset.vote === 'dislike' ? '👎' : '👍';
      void api(`/reels/${state.reelId}/comments/${encodeURIComponent(id)}/reactions`, { method: 'POST', body: JSON.stringify({ reaction }) }).then(() => load(true)).catch(error => setStatus(error.message));
    }
  }

  async function uploadPendingAttachment() {
    const pending = window.__egybookGetPendingCommentMedia?.() || {};
    const file = pending.image || pending.audio;
    if (!file || !state.reelId) return null;
    const named = file instanceof File ? file : new File([file], 'voice-comment.webm', { type: file.type || 'audio/webm' });
    const form = new FormData(); form.append('file', named, named.name || 'comment-media');
    if (pending.duration) form.append('duration_seconds', String(pending.duration));
    const result = await api(`/reels/${state.reelId}/comment-attachments`, { method: 'POST', body: form });
    return result.attachment;
  }

  async function handleNativeSubmit(event) {
    if (!state.active || event.target?.id !== 'commentForm') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const field = input();
    const text = String(field?.value || '').normalize('NFC').trim();
    const pending = window.__egybookGetPendingCommentMedia?.() || {};
    if ((!text && !pending.image && !pending.audio) || !state.reelId) return;
    const submit = $('#commentForm button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const attachment = await uploadPendingAttachment();
      await api(`/reels/${state.reelId}/comments`, {
        method: 'POST', body: JSON.stringify({ comment_text: text, parent_comment_id: state.parentId, attachment })
      });
      field.value = ''; field.placeholder = 'اكتب تعليقًا...'; delete field.dataset.replyingTo;
      state.parentId = null; window.__egybookClearPendingCommentMedia?.();
      await load(true);
    } catch (error) { setStatus(error.message || 'تعذر إرسال التعليق.'); }
    finally { if (submit) submit.disabled = false; }
  }


  function handleSort(event) {
    if (!state.active) return;
    const option = event.target.closest('#commentsSortMenu [data-action="sort-comments"]');
    if (!option) return;
    event.preventDefault(); event.stopImmediatePropagation();
    state.sort = option.dataset.sort === 'relevant' ? 'relevant' : 'recent';
    const menu = $('#commentsSortMenu'); if (menu) menu.hidden = true;
    const button = $('#commentsSortButton');
    const label = button?.querySelector('span');
    if (label) label.textContent = option.querySelector('span')?.textContent || option.textContent.trim();
    void load(true);
  }

  function clearMode() {
    state.active = false; state.post = null; state.postId = ''; state.reelId = null;
    state.comments = []; state.profiles = {}; state.attachments = []; state.pendingAttachment = null; state.offset = 0; state.hasMore = false; state.parentId = null;
    document.body.classList.remove('reels-comments-open');
    document.documentElement.classList.remove('reels-comments-open');
    const commentsModal = modal(); commentsModal?.classList.remove('reels-neon-comments');
    const field = input(); if (field) { field.placeholder = 'اكتب تعليقًا...'; delete field.dataset.replyingTo; }
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
    state.parentId = null; state.sort = 'relevant';
    void resolveReel(detail).then(() => load(true)).catch(error => setStatus(error.message));
  });

  // Capture phase prevents the legacy Supabase form handler from receiving Reels submits.
  document.addEventListener('click', handleNativeClick, true);
  document.addEventListener('click', handleSort, true);
  document.addEventListener('submit', handleNativeSubmit, true);
  // The original composer owns image selection and voice recording; Neon consumes its pending Blob/File.

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
