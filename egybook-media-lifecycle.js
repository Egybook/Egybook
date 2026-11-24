/* EgyBook V238.2 — Smart Media Lifecycle coordinator.
 * Coordinates the existing feed, Reels preview and canonical-player owners.
 * It does not create media players, change sources, fetch data, or add gestures.
 */
(() => {
  'use strict';
  if (window.EgyBookMediaLifecycleV2382?.version === '238.2') return;

  const FEED_PAGES = new Set(['home', 'profile', 'explore', 'saved', 'friends']);
  let activePage = String(document.body?.dataset?.egybookActivePage || 'home');
  let suspended = !!document.hidden;
  let suspendReason = suspended ? 'initial-hidden' : '';
  let routeToken = 0;
  let resumeFrame = 0;

  function emit(target, type, detail) {
    try { target.dispatchEvent(new CustomEvent(type, { detail })); } catch (_) {}
  }
  function suspend(reason = 'lifecycle') {
    suspended = true;
    suspendReason = String(reason || 'lifecycle');
    emit(document, 'egybook:feed-media-suspend', { reason: suspendReason });
    emit(window, 'egybook:media-lifecycle-reels-suspend', { reason: suspendReason });
  }
  function resume(reason = 'foreground') {
    if (document.hidden) return false;
    // visibilitychange and pageshow can both describe the same foreground
    // transition. Emit one resume signal so media owners do not duplicate work.
    if (!suspended) return true;
    suspended = false;
    suspendReason = '';
    if (FEED_PAGES.has(activePage)) {
      emit(document, 'egybook:feed-media-resume', { reason });
    }
    if (activePage === 'reels') {
      emit(window, 'egybook:media-lifecycle-reels-resume', { reason });
    }
    return true;
  }
  function handleRouteChange(event) {
    const next = String(event?.detail?.page || document.body?.dataset?.egybookActivePage || activePage);
    if (!next || next === activePage) return;
    activePage = next;
    routeToken++;
    if (resumeFrame) cancelAnimationFrame(resumeFrame);
    suspend(`route:${next}`);
    if (!document.hidden) {
      const token = routeToken;
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0;
        if (token !== routeToken || document.hidden) return;
        resume(`route:${next}`);
      });
    }
  }
  function handleVisibility() {
    if (document.visibilityState === 'hidden') {
      routeToken++;
      if (resumeFrame) cancelAnimationFrame(resumeFrame);
      resumeFrame = 0;
      suspend('document-hidden');
    } else {
      resume('document-visible');
    }
  }
  document.addEventListener('egybook:primarypagechange', handleRouteChange);
  document.addEventListener('egybook:pagechange', handleRouteChange);
  document.addEventListener('visibilitychange', handleVisibility, { passive: true });
  window.addEventListener('pagehide', () => suspend('pagehide'), { passive: true });
  window.addEventListener('pageshow', () => resume('pageshow'), { passive: true });

  const snapshot = () => {
    const player = document.getElementById('egybookVideoPlayer');
    const audio = ['egybookVideoAudio', 'egybookVideoSourceAudio']
      .map(id => document.getElementById(id)).filter(Boolean);
    const feedVideos = Array.from(document.querySelectorAll('.post video.post-image'));
    const previewVideos = Array.from(document.querySelectorAll('#egybookVideoBox .evp-swipe-preview video'));
    const playing = media => !!media && !media.paused && !media.ended;
    return Object.freeze({
      version: '238.2',
      page: activePage,
      hidden: !!document.hidden,
      suspended,
      suspendReason,
      canonicalVideoPlaying: playing(player),
      canonicalAudioPlaying: audio.filter(playing).length,
      feedVideoElements: feedVideos.length,
      feedVideosPlaying: feedVideos.filter(playing).length,
      reelsPreviewVideoElements: previewVideos.length,
      reelsPreviewVideosPlaying: previewVideos.filter(playing).length
    });
  };

  window.EgyBookMediaLifecycleV2382 = Object.freeze({
    version: '238.2',
    suspend,
    resume,
    getSnapshot: snapshot
  });

  if (document.hidden) suspend('initial-hidden');
  else requestAnimationFrame(() => resume('initial-visible'));
})();
