/* EgyBook V232 — Reels return fallback coordinator.
 * Keeps route recovery outside the primary script/styles files. It does not
 * create a player, alter media URLs, or add another swipe implementation.
 */
(() => {
  'use strict';
  if (window.EgyBookReelsReturnRecoveryV232?.version === '232.0') return;

  let pending = null;
  let pendingRouteToken = null;

  function hasPresentableFrame(player) {
    return !!player && !player.error && Number(player.networkState) !== 3 &&
      Number(player.readyState) >= 2 && Number(player.videoWidth) > 0 && Number(player.videoHeight) > 0;
  }

  function shouldFallback(modal, player) {
    if (!modal || modal.dataset?.evpSuspendedForRoute !== 'true') return false;
    if (modal.dataset?.evpResumeFailed === 'true') return true;
    return !hasPresentableFrame(player);
  }

  function recover(options = {}) {
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    const modal = document.getElementById('egybookVideoModal');
    if (!modal || modal.dataset?.evpSuspendedForRoute !== 'true' || !isCurrent()) {
      return Promise.resolve({ ok: false, stale: true, post: null });
    }
    if (pending && pendingRouteToken === options.routeToken) return pending;

    const previousPostId = String(modal.dataset.evpRecoveryPostId || modal.dataset.postId || '');
    modal.dataset.evpResumeFailed = 'true';
    modal.dataset.evpResumeFailureReason = hasPresentableFrame(document.getElementById('egybookVideoPlayer'))
      ? 'previous-resume-failed' : 'return-frame-not-ready';
    if (previousPostId) modal.dataset.evpRecoveryPostId = previousPostId;
    delete modal.dataset.evpResumePending;

    const manager = window.EgyBookVideoSourceManager;
    if (!manager?.openReels) return Promise.resolve({ ok: false, error: new Error('REELS_SOURCE_MANAGER_UNAVAILABLE'), post: null });

    const routeToken = options.routeToken ?? null;
    pendingRouteToken = routeToken;
    const task = Promise.resolve().then(() => manager.openReels({
      isCurrent,
      excludePostId: previousPostId,
      fallbackFromNavigation: true
    })).catch(error => ({ ok: false, error, post: null })).then(result => {
      if (!isCurrent()) return { ...(result || {}), ok: false, stale: true };
      return result || { ok: false, post: null };
    }).finally(() => {
      if (pending === task) {
        pending = null;
        pendingRouteToken = null;
      }
    });
    pending = task;
    return task;
  }

  window.EgyBookReelsReturnRecoveryV232 = Object.freeze({
    version: '232.0',
    hasPresentableFrame,
    shouldFallback,
    recover
  });
})();
