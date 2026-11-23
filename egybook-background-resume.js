/* EgyBook V230 — Background & Resume Recovery.
 * Narrow lifecycle guard for the existing canonical Reels player.
 * It never creates a player, changes a media URL, or fetches media.
 */
(() => {
  'use strict';
  if (window.__egybookBackgroundResumeV230) return;

  const MODAL_ID = 'egybookVideoModal';
  const PLAYER_ID = 'egybookVideoPlayer';
  const AUDIO_IDS = ['egybookVideoAudio', 'egybookVideoSourceAudio'];
  const DRIFT_SECONDS = 1.25;
  const MAX_SNAPSHOT_AGE = 30 * 60 * 1000;
  let snapshot = null;
  let restoreToken = 0;
  let restoring = false;

  const byId = id => document.getElementById(id);
  const activeReelsRoute = () =>
    String(document.body?.dataset?.egybookActivePage || '') === 'reels' &&
    document.body?.classList.contains('egybook-reels-active');

  function capture(reason) {
    const modal = byId(MODAL_ID);
    const player = byId(PLAYER_ID);
    if (!modal || !player || !modal.classList.contains('evp-reels-context')) return false;
    // A route-suspended session is owned by the existing navigation bridge.
    if (modal.dataset.evpSuspendedForRoute === 'true') return false;
    const source = String(player.currentSrc || player.getAttribute('src') || player.src || '');
    if (!source) return false;
    const audios = AUDIO_IDS.map(byId).map(audio => audio ? ({
      source: String(audio.currentSrc || audio.getAttribute('src') || audio.src || ''),
      time: Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0,
      wasPlaying: !audio.paused && !audio.ended,
      volume: Number.isFinite(audio.volume) ? audio.volume : 1,
      muted: !!audio.muted
    }) : null);
    snapshot = {
      source,
      postId: String(modal.dataset.postId || ''),
      time: Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0,
      wasPlaying: !player.paused && !player.ended,
      muted: !!player.muted,
      volume: Number.isFinite(player.volume) ? player.volume : 1,
      playbackRate: Number.isFinite(player.playbackRate) ? player.playbackRate : 1,
      audios,
      capturedAt: Date.now(),
      reason
    };
    return true;
  }

  function samePlayerContext(modal, player, saved) {
    if (!activeReelsRoute() || !modal || !player || !saved) return false;
    if (!modal.classList.contains('evp-reels-context') || modal.dataset.evpSuspendedForRoute === 'true') return false;
    const source = String(player.currentSrc || player.getAttribute('src') || player.src || '');
    const sameSource = source === saved.source ||
      window.EgyBookVideoURLRenewalV231?.sameResource?.(source, saved.source) === true;
    return sameSource && String(modal.dataset.postId || '') === saved.postId;
  }

  function restore(reason) {
    if (!snapshot || restoring) return false;
    const saved = snapshot;
    if (Date.now() - saved.capturedAt > MAX_SNAPSHOT_AGE) { snapshot = null; return false; }
    const modal = byId(MODAL_ID);
    const player = byId(PLAYER_ID);
    if (!samePlayerContext(modal, player, saved)) return false;

    const token = ++restoreToken;
    restoring = true;
    const finish = () => {
      if (token !== restoreToken || snapshot !== saved || !samePlayerContext(modal, player, saved)) return;
      restoring = false;
      snapshot = null;
      if (saved.wasPlaying && player.paused) {
        try { const promise = player.play(); if (promise?.catch) promise.catch(() => {}); } catch (_) {}
      }
      AUDIO_IDS.forEach((id, index) => {
        const audio = byId(id), state = saved.audios[index];
        if (!audio || !state || !state.wasPlaying) return;
        const currentSource = String(audio.currentSrc || audio.getAttribute('src') || audio.src || '');
        if (currentSource !== state.source || audio.ended) return;
        try {
          audio.muted = state.muted;
          audio.volume = Math.max(0, Math.min(1, state.volume));
          if (Number.isFinite(audio.duration) && audio.duration > 0 && Math.abs(audio.currentTime - state.time) > DRIFT_SECONDS) {
            audio.currentTime = Math.min(state.time, Math.max(0, audio.duration - 0.08));
          }
        } catch (_) {}
        if (audio.paused) { try { const promise = audio.play(); if (promise?.catch) promise.catch(() => {}); } catch (_) {} }
      });
    };
    const apply = () => {
      if (token !== restoreToken || !samePlayerContext(modal, player, saved)) { restoring = false; return; }
      if (player.readyState < 1) { restoring = false; return; }
      try {
        player.muted = saved.muted;
        player.volume = Math.max(0, Math.min(1, saved.volume));
        player.playbackRate = Math.max(0.25, Math.min(4, saved.playbackRate));
        if (Number.isFinite(player.duration) && player.duration > 0 && Math.abs(player.currentTime - saved.time) > DRIFT_SECONDS) {
          const target = Math.min(saved.time, Math.max(0, player.duration - 0.08));
          player.currentTime = target;
          if (player.seeking) {
            const onSeeked = () => { player.removeEventListener('seeked', onSeeked); finish(); };
            player.addEventListener('seeked', onSeeked, { once: true });
            setTimeout(() => { player.removeEventListener('seeked', onSeeked); finish(); }, 1400);
            return;
          }
        }
      } catch (_) {}
      finish();
    };
    if (player.readyState >= 1) apply();
    else {
      restoring = false;
      // The V231 stage owns source renewal and metadata recovery. Do not attach
      // competing source/load handlers here when metadata is unavailable.
      return false;
    }
    return true;
  }

  // V231 may rotate a Hovod ticket and replace its manifest URL while
  // keeping the same playback identity. Retry the retained snapshot when the
  // canonical player receives metadata instead of abandoning the first resume.
  const retainedPlayer = byId(PLAYER_ID);
  retainedPlayer?.addEventListener('loadedmetadata', () => {
    if (!snapshot || restoring || !activeReelsRoute()) return;
    restore('metadata-ready');
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') capture('visibility-hidden');
    else restore('visibility-visible');
  }, { passive: true });
  window.addEventListener('pagehide', event => {
    capture(event.persisted ? 'pagehide-bfcache' : 'pagehide');
  }, { passive: true });
  window.addEventListener('pageshow', event => {
    if (event.persisted) restore('pageshow-bfcache');
  }, { passive: true });

  window.__egybookBackgroundResumeV230 = Object.freeze({
    version: 'V230',
    capture: () => capture('manual'),
    restore: () => restore('manual'),
    hasSnapshot: () => !!snapshot
  });
})();
