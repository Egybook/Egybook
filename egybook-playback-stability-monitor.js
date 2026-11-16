/* EgyBook Playback Stability Monitor v51
 * Passive diagnostics for the existing primary video player only.
 * No playback control, network requests, persistent storage, or UI changes.
 */
(() => {
  'use strict';
  if (window.EgyBookPlaybackMonitor?.version === 51) return;
  const player = document.getElementById('egybookVideoPlayer');
  if (!player) return;

  const state = {
    version: 51,
    sessions: 0,
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
  let sourceKey = player.currentSrc || player.getAttribute('src') || '';
  let sourceStartedAt = performance.now();
  let firstFramePending = false;
  let frameToken = 0;

  const now = () => performance.now();
  const markEvent = () => {
    state.lastEventAt = Date.now();
    state.lastReadyState = Number(player.readyState) || 0;
    state.lastNetworkState = Number(player.networkState) || 0;
  };
  const publish = (name) => {
    markEvent();
    try {
      window.dispatchEvent(new CustomEvent('egybook:playback-diagnostic', {
        detail: { event: name, snapshot: getSnapshot() }
      }));
    } catch (_) {}
  };
  const getSnapshot = () => ({
    version: state.version,
    sessions: state.sessions,
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
  const beginSource = () => {
    const nextKey = player.currentSrc || player.getAttribute('src') || '';
    if (nextKey === sourceKey && sourceStartedAt) return;
    sourceKey = nextKey;
    sourceStartedAt = now();
    state.firstFrameMs = null;
    state.startupMs = null;
    firstFramePending = false;
    state.currentWaitingSince = 0;
    publish('source-change');
  };
  const recordFirstFrame = () => {
    if (state.firstFrameMs !== null || firstFramePending) return;
    firstFramePending = true;
    const elapsed = Math.max(0, now() - sourceStartedAt);
    const done = () => {
      if (!firstFramePending) return;
      firstFramePending = false;
      state.firstFrameMs = Math.round(elapsed);
      publish('first-frame');
    };
    if (typeof player.requestVideoFrameCallback === 'function') {
      try { frameToken = player.requestVideoFrameCallback(done); return; } catch (_) {}
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
  };

  player.addEventListener('loadstart', () => { beginSource(); publish('loadstart'); }, { passive: true });
  player.addEventListener('loadeddata', recordFirstFrame, { passive: true });
  player.addEventListener('playing', () => {
    state.sessions += 1;
    if (state.startupMs === null) state.startupMs = Math.round(Math.max(0, now() - sourceStartedAt));
    if (state.currentWaitingSince) {
      state.totalWaitingMs += now() - state.currentWaitingSince;
      state.currentWaitingSince = 0;
    }
    publish('playing');
  }, { passive: true });
  player.addEventListener('waiting', () => {
    state.waitingCount += 1;
    if (!state.currentWaitingSince) state.currentWaitingSince = now();
    publish('waiting');
  }, { passive: true });
  player.addEventListener('stalled', () => { state.stalledCount += 1; publish('stalled'); }, { passive: true });
  player.addEventListener('error', () => {
    state.errorCount += 1;
    state.lastErrorCode = Number(player.error?.code) || 0;
    publish('error');
  }, { passive: true });
  player.addEventListener('seeked', markEvent, { passive: true });
  player.addEventListener('emptied', () => { beginSource(); publish('emptied'); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.currentWaitingSince) {
      state.totalWaitingMs += now() - state.currentWaitingSince;
      state.currentWaitingSince = 0;
    }
  }, { passive: true });

  window.EgyBookPlaybackMonitor = Object.freeze({
    version: 51,
    getSnapshot,
    reset() {
      state.sessions = 0;
      state.firstFrameMs = null;
      state.startupMs = null;
      state.waitingCount = 0;
      state.stalledCount = 0;
      state.errorCount = 0;
      state.lastErrorCode = 0;
      state.totalWaitingMs = 0;
      state.currentWaitingSince = 0;
      publish('reset');
      return getSnapshot();
    }
  });
  publish('initialized');
})();
