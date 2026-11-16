/* EgyBook Playback Stability Monitor v52
 * Passive, per-source diagnostics for the existing primary video player.
 * No playback control, network requests, persistent storage, or UI changes.
 */
(() => {
  'use strict';
  if (window.EgyBookPlaybackMonitor?.version === 52) return;
  const player = document.getElementById('egybookVideoPlayer');
  if (!player) return;

  const state = {
    version: 52,
    sourceGeneration: 0,
    sessions: 0,
    playEvents: 0,
    firstFrameMs: null,
    startupMs: null,
    waitingCount: 0,
    stalledCount: 0,
    errorCount: 0,
    lastErrorCode: 0,
    lastEventAt: 0,
    totalWaitingMs: 0,
    currentWaitingSince: 0,
    lastReadyState: Number(player.readyState) || 0,
    lastNetworkState: Number(player.networkState) || 0
  };

  let sourceStartedAt = performance.now();
  let firstFramePending = false;
  let hasPlayedCurrentSource = false;

  const now = () => performance.now();
  const markEvent = () => {
    state.lastEventAt = Date.now();
    state.lastReadyState = Number(player.readyState) || 0;
    state.lastNetworkState = Number(player.networkState) || 0;
  };
  const finishWaiting = () => {
    if (!state.currentWaitingSince) return;
    state.totalWaitingMs += Math.max(0, now() - state.currentWaitingSince);
    state.currentWaitingSince = 0;
  };
  const getSnapshot = () => ({
    version: state.version,
    sourceGeneration: state.sourceGeneration,
    sessions: state.sessions,
    playEvents: state.playEvents,
    firstFrameMs: state.firstFrameMs,
    startupMs: state.startupMs,
    waitingCount: state.waitingCount,
    stalledCount: state.stalledCount,
    errorCount: state.errorCount,
    lastErrorCode: state.lastErrorCode,
    totalWaitingMs: Math.round(state.totalWaitingMs + (state.currentWaitingSince ? now() - state.currentWaitingSince : 0)),
    readyState: Number(player.readyState) || 0,
    networkState: Number(player.networkState) || 0,
    paused: !!player.paused,
    ended: !!player.ended
  });
  const publish = (name) => {
    markEvent();
    try {
      window.dispatchEvent(new CustomEvent('egybook:playback-diagnostic', {
        detail: { event: name, snapshot: getSnapshot() }
      }));
    } catch (_) {}
  };
  const beginSource = () => {
    finishWaiting();
    sourceStartedAt = now();
    state.sourceGeneration += 1;
    state.firstFrameMs = null;
    state.startupMs = null;
    state.currentWaitingSince = 0;
    hasPlayedCurrentSource = false;
    firstFramePending = false;
    publish('source-change');
  };
  const recordFirstFrame = () => {
    if (state.firstFrameMs !== null || firstFramePending) return;
    firstFramePending = true;
    const generation = state.sourceGeneration;
    const elapsed = Math.max(0, now() - sourceStartedAt);
    const done = () => {
      // Ignore a callback queued by the previous source after a rapid swipe.
      if (!firstFramePending || generation !== state.sourceGeneration) return;
      firstFramePending = false;
      state.firstFrameMs = Math.round(elapsed);
      publish('first-frame');
    };
    if (typeof player.requestVideoFrameCallback === 'function') {
      try { player.requestVideoFrameCallback(done); return; } catch (_) {}
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
  };

  // loadstart marks a new media loading cycle, including a reload of the same URL.
  player.addEventListener('loadstart', beginSource, { passive: true });
  player.addEventListener('loadeddata', recordFirstFrame, { passive: true });
  player.addEventListener('playing', () => {
    state.playEvents += 1;
    if (!hasPlayedCurrentSource) {
      hasPlayedCurrentSource = true;
      state.sessions += 1;
      if (state.startupMs === null) state.startupMs = Math.round(Math.max(0, now() - sourceStartedAt));
    }
    finishWaiting();
    publish('playing');
  }, { passive: true });
  player.addEventListener('waiting', () => {
    state.waitingCount += 1;
    if (!state.currentWaitingSince) state.currentWaitingSince = now();
    publish('waiting');
  }, { passive: true });
  player.addEventListener('stalled', () => { state.stalledCount += 1; publish('stalled'); }, { passive: true });
  player.addEventListener('error', () => {
    finishWaiting();
    state.errorCount += 1;
    state.lastErrorCode = Number(player.error?.code) || 0;
    publish('error');
  }, { passive: true });
  player.addEventListener('pause', finishWaiting, { passive: true });
  player.addEventListener('ended', finishWaiting, { passive: true });
  player.addEventListener('seeked', markEvent, { passive: true });
  player.addEventListener('emptied', () => { finishWaiting(); publish('emptied'); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finishWaiting();
  }, { passive: true });

  window.EgyBookPlaybackMonitor = Object.freeze({
    version: 52,
    getSnapshot,
    reset() {
      state.sessions = 0;
      state.playEvents = 0;
      state.firstFrameMs = null;
      state.startupMs = null;
      state.waitingCount = 0;
      state.stalledCount = 0;
      state.errorCount = 0;
      state.lastErrorCode = 0;
      state.totalWaitingMs = 0;
      state.currentWaitingSince = 0;
      hasPlayedCurrentSource = false;
      sourceStartedAt = now();
      state.sourceGeneration += 1;
      firstFramePending = false;
      publish('reset');
      return getSnapshot();
    }
  });
  publish('initialized');
})();
