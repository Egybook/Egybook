/* EgyBook V235 — Reels social rail persistence guard.
 * Reconciles the existing author/action rail with the active Reels post.
 * It does not create a second player, alter media playback, or write to storage.
 */
(function () {
  'use strict';

  if (window.__egybookReelsRailGuardV235) return;
  window.__egybookReelsRailGuardV235 = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const modal = $('#egybookVideoModal');
  const box = $('#egybookVideoBox');
  const rail = $('#evpPostRail');
  const comments = $('#commentsModal');

  if (!modal || !box || !rail) return;

  const requiredRailNodes = [
    '.evp-creator',
    '.evp-reaction-wrap',
    '[data-evp="post-like"]',
    '[data-evp="post-comment"]',
    '[data-evp="post-share"]',
    '[data-evp="post-save"]'
  ];

  let activePost = null;
  let frameQueued = false;
  let lastBoundPostId = '';

  function isReelsVideoOpen() {
    return modal.classList.contains('open') &&
      !modal.hidden &&
      modal.classList.contains('evp-reels-context') &&
      String(modal.dataset.mediaKind || '').toLowerCase() === 'video';
  }

  function isCommentsOverlayActuallyOpen() {
    return !!comments &&
      comments.classList.contains('open') &&
      comments.classList.contains('evp-comments-overlay') &&
      !comments.hidden;
  }

  function findPostById(postId) {
    if (!postId) return null;
    const candidates = document.querySelectorAll('.post[data-post-id]');
    for (const candidate of candidates) {
      if (String(candidate.dataset.postId || '') === postId) return candidate;
    }
    return null;
  }

  function currentPost() {
    const postId = String(modal.dataset.postId || '');
    if (activePost && activePost.isConnected &&
        String(activePost.dataset.postId || '') === postId) return activePost;
    const resolved = findPostById(postId);
    if (resolved) activePost = resolved;
    return resolved;
  }

  function removeStaleCommentsState() {
    // The player intentionally hides its action rail while the real comments
    // overlay is open. Clear only a stale player flag after that overlay closes.
    if (isCommentsOverlayActuallyOpen()) return false;
    const hadStaleFlag = box.classList.contains('evp-comments-open');
    if (hadStaleFlag) box.classList.remove('evp-comments-open');
    return hadStaleFlag;
  }

  function setVisible(node) {
    if (!node) return;
    if (node.hidden) node.hidden = false;
    if (node.hasAttribute('hidden')) node.removeAttribute('hidden');
    if (node.style) {
      if (node.style.display === 'none') node.style.removeProperty('display');
      if (node.style.visibility === 'hidden') node.style.removeProperty('visibility');
      if (node.style.opacity === '0') node.style.removeProperty('opacity');
    }
    if (node.getAttribute('aria-hidden') === 'true') node.setAttribute('aria-hidden', 'false');
  }

  function syncAuthor(post, postId) {
    if (!post) return;
    const authorName = $('.post-author .author-name', post)?.textContent?.trim() || 'عضو EgyBook';
    const sourceAvatar = $('.post-header .avatar', post);
    const avatarImage = sourceAvatar?.querySelector('img');
    const imageUrl = avatarImage?.currentSrc || avatarImage?.src || '';
    const backgroundImage = sourceAvatar?.style?.backgroundImage ||
      (imageUrl ? `url("${imageUrl.replace(/"/g, '%22')}")` : '');
    const nameNode = $('#evpAuthorName', rail);
    const avatarNode = $('#evpAuthorAvatar', rail);

    if (nameNode && nameNode.textContent !== authorName) nameNode.textContent = authorName;
    if (avatarNode) {
      if (backgroundImage && avatarNode.style.backgroundImage !== backgroundImage) {
        avatarNode.style.backgroundImage = backgroundImage;
        avatarNode.textContent = '';
      } else if (!backgroundImage) {
        if (avatarNode.style.backgroundImage) avatarNode.style.backgroundImage = '';
        const initial = authorName.charAt(0) || 'ح';
        if (avatarNode.textContent !== initial) avatarNode.textContent = initial;
      }
      avatarNode.setAttribute('aria-label', `صورة ${authorName}`);
      avatarNode.setAttribute('role', 'img');
    }

    const sourceLike = $('[data-action="like"]', post);
    const railLike = $('[data-evp="post-like"]', rail);
    if (railLike && sourceLike) {
      const reaction = String(sourceLike.dataset.currentReaction || '');
      railLike.classList.toggle('is-active', !!reaction);
      railLike.dataset.currentReaction = reaction;
      railLike.setAttribute('aria-pressed', String(!!reaction));
    }

    const sourceSave = $('[data-action="save"]', post);
    const railSave = $('[data-evp="post-save"]', rail);
    if (railSave && sourceSave) {
      const saved = sourceSave.classList.contains('saved');
      railSave.classList.toggle('is-active', saved);
      railSave.setAttribute('aria-pressed', String(saved));
      const label = $('small', railSave);
      if (label) label.textContent = saved ? 'تم الحفظ' : 'حفظ';
    }

    rail.dataset.egybookBoundPostId = postId;
    lastBoundPostId = postId;
  }

  function reconcile() {
    if (!isReelsVideoOpen()) {
      box.classList.remove('evp-reels-rail-ready');
      return false;
    }

    if (isCommentsOverlayActuallyOpen()) {
      box.classList.remove('evp-reels-rail-ready');
      return false;
    }

    removeStaleCommentsState();

    const postId = String(modal.dataset.postId || '');
    const post = currentPost();
    if (!postId || !post || String(post.dataset.postId || '') !== postId) {
      // Do not show stale controls from a previous Reel while the next post is
      // still being materialized. Keep the existing binding only for same ID.
      if (postId && lastBoundPostId === postId && rail.dataset.egybookBoundPostId === postId) {
        rail.hidden = false;
        box.classList.add('evp-reels-rail-ready');
        return true;
      }
      box.classList.remove('evp-reels-rail-ready');
      return false;
    }

    syncAuthor(post, postId);

    // These are the existing, delegated-action nodes from index.html. The guard
    // only restores their visible state; it does not replace or duplicate them.
    setVisible(rail);
    for (const selector of requiredRailNodes) setVisible($(selector, rail));
    setVisible($('#evpAuthorAvatar', rail));
    setVisible($('#evpAuthorName', rail));

    rail.hidden = false;
    if (rail.getAttribute('aria-hidden') !== 'false') rail.setAttribute('aria-hidden', 'false');
    box.classList.add('evp-reels-rail-ready');
    return true;
  }

  function schedule() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      reconcile();
    });
  }

  window.addEventListener('egybook:evp-post-context', event => {
    const post = event.detail?.post;
    if (post?.dataset?.postId) activePost = post;
    schedule();
  });

  // A queue item can update the post before the modal's postId is committed.
  // Re-run once the modal attributes and the shared rail have settled.
  const modalObserver = new MutationObserver(schedule);
  modalObserver.observe(modal, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'data-post-id', 'data-media-kind']
  });
  const boxObserver = new MutationObserver(schedule);
  boxObserver.observe(box, { attributes: true, attributeFilter: ['class'] });
  const railObserver = new MutationObserver(schedule);
  railObserver.observe(rail, {
    attributes: true,
    attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'],
    childList: true,
    subtree: true
  });
  if (comments) {
    const commentsObserver = new MutationObserver(schedule);
    commentsObserver.observe(comments, {
      attributes: true,
      attributeFilter: ['class', 'hidden']
    });
  }

  window.addEventListener('pageshow', schedule);
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });

  window.EgyBookReelsRailGuard = Object.freeze({
    version: '235',
    refresh: reconcile,
    getState() {
      return {
        active: isReelsVideoOpen(),
        commentsOpen: isCommentsOverlayActuallyOpen(),
        postId: String(modal.dataset.postId || ''),
        boundPostId: String(rail.dataset.egybookBoundPostId || ''),
        railHidden: !!rail.hidden,
        requiredNodesPresent: requiredRailNodes.every(selector => !!$(selector, rail))
      };
    }
  });

  schedule();
})();
