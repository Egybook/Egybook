/* EgyBook V229.1 — Shared Home/Profile feed video preview lease.
 * Reuses the same native inline preview element when a post exists in both
 * Home and Profile. Moving the existing node preserves its decoder/buffer;
 * this module never fetches media, calls load(), or touches the Reels player.
 */
(() => {
  'use strict';
  if (window.__egybookSharedFeedMediaV2291) return;

  const ROOTS = {
    home: '#postsList',
    profile: '#profilePostsList'
  };
  const leases = new Map();
  let activePage = String(document.body?.dataset?.egybookActivePage || 'home');
  let scanQueued = false;
  let scanObserver = null;

  function normalizedSource(video) {
    if (!video) return '';
    const raw = video.dataset.feedSrc || video.getAttribute('src') || video.currentSrc || video.src || '';
    if (!raw) return '';
    try { return new URL(raw, document.baseURI).href; } catch (_) { return String(raw); }
  }

  function getFrame(video) {
    // script.js wraps every registered feed preview before the next paint.
    // Wait for that wrapper instead of leasing the bare <video> too early.
    return video?.closest('.egybook-feed-video-frame') || null;
  }

  function findCards(root) {
    const result = new Map();
    if (!root) return result;
    root.querySelectorAll('.post[data-post-id]').forEach(card => {
      const id = String(card.dataset.postId || '');
      if (!id) return;
      const video = card.querySelector('video.egybook-feed-video, video.post-image');
      if (!video) return;
      const frame = getFrame(video);
      const source = normalizedSource(video);
      if (!frame || !source) return;
      result.set(id, { card, video, frame, source });
    });
    return result;
  }

  function videoScore(video) {
    if (!video) return -1;
    let buffered = 0;
    try { if (video.buffered?.length) buffered = Math.min(30, video.buffered.end(video.buffered.length - 1)); } catch (_) {}
    return (Number(video.readyState) || 0) * 12 + (Number(video.currentTime) > 0.5 ? 8 : 0) + (!video.paused ? 12 : 0) + Math.min(30, buffered);
  }

  function insertAnchorBefore(frame, label) {
    const parent = frame?.parentNode;
    if (!parent) return null;
    const anchor = document.createComment(`EgyBook shared media ${label}`);
    parent.insertBefore(anchor, frame);
    return anchor;
  }

  function retireDuplicate(frame, keepVideo) {
    if (!frame || frame === keepVideo || frame.contains?.(keepVideo)) return;
    const videos = frame.matches?.('video') ? [frame] : Array.from(frame.querySelectorAll?.('video') || []);
    videos.forEach(video => {
      try { video.pause(); } catch (_) {}
      // This is a discarded duplicate preview only. The retained native video
      // node is never detached from its source or asked to load again.
      try {
        video.removeAttribute('src');
        delete video.dataset.feedSrc;
        video.load();
      } catch (_) {}
    });
    frame.remove?.();
  }

  function createLease(postId, homeItem, profileItem) {
    if (homeItem.source !== profileItem.source) return null;
    const homeAnchor = insertAnchorBefore(homeItem.frame, `home:${postId}`);
    const profileAnchor = insertAnchorBefore(profileItem.frame, `profile:${postId}`);
    if (!homeAnchor || !profileAnchor) {
      homeAnchor?.remove();
      profileAnchor?.remove();
      return null;
    }

    const keepHome = videoScore(homeItem.video) >= videoScore(profileItem.video);
    const keeper = keepHome ? homeItem : profileItem;
    const duplicate = keepHome ? profileItem : homeItem;
    retireDuplicate(duplicate.frame, keeper.video);

    const lease = {
      postId,
      source: homeItem.source,
      frame: keeper.frame,
      video: keeper.video,
      homeAnchor,
      profileAnchor,
      keeperInitially: keepHome ? 'home' : 'profile'
    };
    try { window.EgyBookSmartFeed?.registerVideo?.(lease.video, postId); } catch (_) {}
    leases.set(postId, lease);
    return lease;
  }

  function moveLease(lease, page) {
    const anchor = page === 'profile' ? lease.profileAnchor : lease.homeAnchor;
    if (!anchor?.parentNode || !lease.frame) return false;
    if (lease.frame.parentNode === anchor.parentNode && lease.frame.nextSibling === anchor) return true;
    anchor.parentNode.insertBefore(lease.frame, anchor);
    // Keep the same post association after moving between the two roots.
    try { window.EgyBookSmartFeed?.registerVideo?.(lease.video, lease.postId); } catch (_) {}
    lease.video.dataset.sharedFeedPreview = page;
    return true;
  }

  function pruneLeases() {
    for (const [postId, lease] of leases) {
      const homeAlive = !!lease.homeAnchor?.isConnected;
      const profileAlive = !!lease.profileAnchor?.isConnected;
      if (homeAlive && profileAlive) continue;

      // Profile lists can be replaced when the viewed account changes. If one
      // anchor card disappears, return the retained native video to the other
      // surviving card before dropping the lease. This prevents a removed
      // profile subtree from taking the Home feed's only live preview with it.
      const survivingAnchor = homeAlive ? lease.homeAnchor : (profileAlive ? lease.profileAnchor : null);
      if (survivingAnchor?.parentNode && lease.frame) {
        survivingAnchor.parentNode.insertBefore(lease.frame, survivingAnchor);
        survivingAnchor.remove();
      }
      if (homeAlive) lease.profileAnchor?.remove?.();
      if (profileAlive) lease.homeAnchor?.remove?.();
      leases.delete(postId);
    }
  }

  function scan() {
    scanQueued = false;
    pruneLeases();
    if (activePage !== 'home' && activePage !== 'profile') return;
    const homeRoot = document.querySelector(ROOTS.home);
    const profileRoot = document.querySelector(ROOTS.profile);
    if (!homeRoot || !profileRoot) return;
    const homeCards = findCards(homeRoot);
    const profileCards = findCards(profileRoot);

    for (const [postId, homeItem] of homeCards) {
      const profileItem = profileCards.get(postId);
      if (!profileItem) continue;
      let lease = leases.get(postId);
      if (!lease) lease = createLease(postId, homeItem, profileItem);
      if (!lease || lease.source !== homeItem.source || lease.source !== profileItem.source) continue;
      moveLease(lease, activePage);
    }

    // An already-created lease may be needed even when its inactive duplicate
    // has been removed from the card map. Its saved anchors identify both slots.
    for (const lease of leases.values()) {
      if (lease.homeAnchor?.isConnected && lease.profileAnchor?.isConnected) moveLease(lease, activePage);
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    window.requestAnimationFrame(scan);
  }

  function onPageChange(event) {
    activePage = String(event?.detail?.page || document.body?.dataset?.egybookActivePage || 'home');
    queueScan();
  }

  function init() {
    if (window.MutationObserver) {
      scanObserver = new MutationObserver(queueScan);
      [document.querySelector(ROOTS.home), document.querySelector(ROOTS.profile)].filter(Boolean)
        .forEach(root => scanObserver.observe(root, { childList: true, subtree: true }));
    }
    document.addEventListener('egybook:primarypagechange', onPageChange);
    document.addEventListener('egybook:pagechange', onPageChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') queueScan();
    });
    queueScan();
  }

  window.__egybookSharedFeedMediaV2291 = Object.freeze({
    version: 'V229.1',
    scan: queueScan,
    getLeaseCount: () => leases.size
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
