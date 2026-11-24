/* EgyBook V238.2 — Background media lifecycle.
 * Retains the current media identity, pauses active playback when the app is
 * backgrounded, and restarts from 0:00 on return. It never changes media URLs,
 * fetches media, creates a player, or persists private playback data.
 */
(() => {
  'use strict';
  if (window.__egybookBackgroundResumeV2382?.version === '238.2') return;

  const MODAL_ID = 'egybookVideoModal';
  const PLAYER_ID = 'egybookVideoPlayer';
  const AUDIO_IDS = ['egybookVideoAudio', 'egybookVideoSourceAudio'];
  const MAX_SNAPSHOT_AGE = 30 * 60 * 1000;
  let snapshot = null;
  let restoreToken = 0;
  let restoring = false;

  const byId = id => document.getElementById(id);
  const activeReelsRoute = () =>
    String(document.body?.dataset?.egybookActivePage || '') === 'reels' &&
    document.body?.classList.contains('egybook-reels-active');
  const normalizeSource = value => String(value || '').trim();
  const sameSource = (current, saved) => {
    const a = normalizeSource(current), b = normalizeSource(saved);
    if (!a || !b) return false;
    return a === b || window.EgyBookVideoURLRenewalV231?.sameResource?.(a, b) === true;
  };
  const readSource = media => normalizeSource(media?.currentSrc || media?.getAttribute?.('src') || media?.src || '');
  const resetToStart = media => {
    if (!media) return false;
    try {
      if (Number.isFinite(media.currentTime) && media.currentTime > 0.04) media.currentTime = 0;
      return true;
    } catch (_) { return false; }
  };
  const isEligibleModal = modal => {
    if (!modal || modal.hidden || !modal.classList?.contains('open')) return false;
    if (modal.dataset?.evpSuspendedForRoute === 'true') return false;
    if (modal.classList?.contains('evp-reels-context')) return activeReelsRoute();
    return true;
  };

  function capture(reason) {
    const modal = byId(MODAL_ID);
    const player = byId(PLAYER_ID);
    if (!isEligibleModal(modal) || !player) return false;
    const source = readSource(player);
    if (!source) return false;
    const postId = String(modal.dataset?.postId || '');
    const context = String(modal.dataset?.evpContext || (modal.classList.contains('evp-reels-context') ? 'reels' : 'standard'));

    // visibilitychange and pagehide commonly fire in the same lifecycle turn.
    // Keep the original wasPlaying snapshot instead of overwriting it after pause.
    if (snapshot && sameSource(snapshot.source, source) && snapshot.postId === postId && snapshot.context === context) return true;

    const audioStates = AUDIO_IDS.map(id => {
      const audio = byId(id);
      return audio ? {
        source: readSource(audio),
        wasPlaying: !audio.paused && !audio.ended,
        volume: Number.isFinite(audio.volume) ? audio.volume : 1,
        muted: !!audio.muted,
        preload: String(audio.preload || 'none')
      } : null;
    });

    snapshot = {
      source,
      postId,
      context,
      wasPlaying: !player.paused && !player.ended,
      muted: !!player.muted,
      volume: Number.isFinite(player.volume) ? player.volume : 1,
      playbackRate: Number.isFinite(player.playbackRate) ? player.playbackRate : 1,
      preload: String(player.preload || 'auto'),
      audioStates,
      capturedAt: Date.now(),
      reason: String(reason || 'background')
    };

    // Cancel the independent Hovod-expiry restoration snapshot for this
    // player. Ticket renewal remains active, but it must not restore the old
    // playhead after this lifecycle policy deliberately resets to 0:00.
    try { window.EgyBookVideoURLRenewalV231?.discardPendingRestore?.(player); } catch (_) {}

    try { player.pause(); } catch (_) {}
    resetToStart(player);
    try { player.preload = 'none'; } catch (_) {}
    AUDIO_IDS.forEach(id => {
      const audio = byId(id);
      if (!audio) return;
      try { audio.pause(); } catch (_) {}
      resetToStart(audio);
      try { audio.preload = 'none'; } catch (_) {}
    });

    window.dispatchEvent(new CustomEvent('egybook:media-background-suspended', {
      detail: { context, reason: snapshot.reason, restartOnReturn: true }
    }));
    return true;
  }

  function isSameContext(modal, player, saved) {
    if (!modal || !player || !saved || !isEligibleModal(modal)) return false;
    const context = String(modal.dataset?.evpContext || (modal.classList.contains('evp-reels-context') ? 'reels' : 'standard'));
    if (context !== saved.context) return false;
    if (saved.context === 'reels' && !activeReelsRoute()) return false;
    if (String(modal.dataset?.postId || '') !== saved.postId) return false;
    return sameSource(readSource(player), saved.source);
  }

  function restore(reason) {
    if (!snapshot || restoring || document.visibilityState === 'hidden') return false;
    const saved = snapshot;
    if (Date.now() - saved.capturedAt > MAX_SNAPSHOT_AGE) { snapshot = null; return false; }
    const modal = byId(MODAL_ID);
    const player = byId(PLAYER_ID);
    if (!isSameContext(modal, player, saved)) return false;

    const token = ++restoreToken;
    restoring = true;
    let metadataTimer = 0;
    let seekTimer = 0;

    const cleanup = () => {
      player.removeEventListener('loadedmetadata', onReady);
      player.removeEventListener('loadeddata', onReady);
      player.removeEventListener('seeked', onComplete);
      player.removeEventListener('error', onFailure);
      if (metadataTimer) clearTimeout(metadataTimer);
      if (seekTimer) clearTimeout(seekTimer);
    };
    const fail = () => {
      if (token !== restoreToken || snapshot !== saved) return;
      cleanup(); restoring = false; snapshot = null;
    };
    const complete = () => {
      if (token !== restoreToken || snapshot !== saved || !isSameContext(modal, player, saved)) return;
      cleanup();
      try {
        player.preload = saved.preload;
        player.muted = saved.muted;
        player.volume = Math.max(0, Math.min(1, Number(saved.volume) || 0));
        player.playbackRate = Math.max(0.25, Math.min(4, Number(saved.playbackRate) || 1));
      } catch (_) {}
      AUDIO_IDS.forEach((id, index) => {
        const audio = byId(id), state = saved.audioStates[index];
        if (!audio || !state || !state.wasPlaying) return;
        if (state.source && !sameSource(readSource(audio), state.source)) return;
        try {
          audio.preload = state.preload;
          audio.muted = state.muted;
          audio.volume = Math.max(0, Math.min(1, Number(state.volume) || 0));
          resetToStart(audio);
          if (document.visibilityState !== 'hidden') { const attempt = audio.play(); if (attempt?.catch) attempt.catch(() => {}); }
        } catch (_) {}
      });
      resetToStart(player);
      snapshot = null;
      restoring = false;
      if (saved.wasPlaying) {
        try {
          const attempt = player.play();
          if (attempt?.catch) attempt.catch(() => {});
        } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent('egybook:media-background-restored', {
        detail: { context: saved.context, reason: String(reason || 'visible'), restartedAt: 0 }
      }));
    };
    const onComplete = () => complete();
    const onReady = () => {
      if (token !== restoreToken || snapshot !== saved || !isSameContext(modal, player, saved)) return;
      if (player.readyState < 1) return;
      try { resetToStart(player); } catch (_) {}
      if (player.seeking) {
        player.addEventListener('seeked', onComplete, { once: true });
        seekTimer = setTimeout(complete, 1200);
      } else complete();
    };
    const onFailure = () => fail();

    try { player.preload = saved.preload; } catch (_) {}
    if (player.readyState >= 1) onReady();
    else {
      player.addEventListener('loadedmetadata', onReady);
      player.addEventListener('loadeddata', onReady);
      player.addEventListener('error', onFailure, { once: true });
      metadataTimer = setTimeout(fail, 10000);
    }
    return true;
  }

  const retainedPlayer = byId(PLAYER_ID);
  retainedPlayer?.addEventListener('loadedmetadata', () => {
    if (!snapshot || restoring || document.visibilityState === 'hidden') return;
    restore('metadata-ready');
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') capture('visibility-hidden');
    else restore('visibility-visible');
  }, { passive: true });
  window.addEventListener('pagehide', event => capture(event.persisted ? 'pagehide-bfcache' : 'pagehide'), { passive: true });
  window.addEventListener('pageshow', event => {
    if (event.persisted || document.visibilityState === 'visible') restore('pageshow');
  }, { passive: true });

  window.__egybookBackgroundResumeV2382 = Object.freeze({
    version: '238.2',
    capture: () => capture('manual'),
    restore: () => restore('manual'),
    hasSnapshot: () => !!snapshot,
    getSnapshot: () => snapshot ? {
      context: snapshot.context,
      postId: snapshot.postId,
      wasPlaying: snapshot.wasPlaying,
      ageMs: Math.max(0, Date.now() - snapshot.capturedAt),
      reason: snapshot.reason
    } : null
  });
  // Keep the prior public name as a compatibility alias for the V231 ticket
  // renewal adapter while it checks whether the canonical player's resume is owned here.
  window.__egybookBackgroundResumeV230 = window.__egybookBackgroundResumeV2382;
})();
