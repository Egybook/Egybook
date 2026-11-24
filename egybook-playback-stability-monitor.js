/* EgyBook Playback Stability Monitor v55
 * Passive diagnostics for the canonical player and opt-in Reels warm previews.
 * No playback control, media source mutation, network request, storage write, or UI change.
 */
(() => {
  'use strict';
  if (window.EgyBookPlaybackMonitor?.version === 55) return;
  const player = document.getElementById('egybookVideoPlayer');
  if (!player) return;

  const DEBUG = (() => {
    try { return new URLSearchParams(location.search).get('videoDebug') === '1'; }
    catch (_) { return false; }
  })();
  const state = {
    version: 55,
    sourceGeneration: 0,
    sessions: 0,
    playEvents: 0,
    firstFrameMs: null,
    startupMs: null,
    canPlayMs: null,
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
  let lastPrimaryProgressAt = 0;
  const watchedMedia = new WeakMap();
  const now = () => performance.now();
  const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  function safeSource(media) {
    return String(media?.currentSrc || media?.getAttribute?.('src') || media?.src || '');
  }

  // A short non-reversible fingerprint correlates preview/player resources
  // without adding full or signed media URLs to exported diagnostic reports.
  function sourceKey(media) {
    const value = safeSource(media);
    if (!value) return '';
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function getBufferedRanges(media) {
    const ranges = [];
    try {
      const buffered = media?.buffered;
      const count = Math.min(4, Number(buffered?.length) || 0);
      for (let index = 0; index < count; index++) {
        try { ranges.push({ start: Number(buffered.start(index)), end: Number(buffered.end(index)) }); }
        catch (_) {}
      }
    } catch (_) {}
    return ranges;
  }

  function bufferedAheadSeconds(media) {
    const time = Number(media?.currentTime) || 0;
    const ranges = getBufferedRanges(media);
    for (const range of ranges) {
      if (time >= range.start - 0.25 && time <= range.end + 0.25) return Math.max(0, range.end - time);
    }
    return ranges.length ? 0 : null;
  }

  function resourceTiming(media) {
    const source = safeSource(media);
    if (!source || !/^https?:/i.test(source)) return null;
    try {
      const entries = performance.getEntriesByName(source, 'resource');
      const entry = entries?.[entries.length - 1];
      if (!entry) return { available: false };
      return {
        available: true,
        durationMs: Math.round(Number(entry.duration) || 0),
        requestStartMs: Math.round(Number(entry.requestStart) || 0),
        responseStartMs: Math.round(Number(entry.responseStart) || 0),
        transferSize: finite(entry.transferSize),
        encodedBodySize: finite(entry.encodedBodySize),
        decodedBodySize: finite(entry.decodedBodySize),
        nextHopProtocol: String(entry.nextHopProtocol || '').slice(0, 24)
      };
    } catch (_) { return { available: false }; }
  }

  function connectionSnapshot() {
    try {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
      return {
        online: navigator.onLine !== false,
        effectiveType: String(connection?.effectiveType || 'unknown'),
        downlinkMbps: finite(connection?.downlink),
        rttMs: finite(connection?.rtt),
        saveData: !!connection?.saveData
      };
    } catch (_) { return { online: typeof navigator === 'undefined' ? null : navigator.onLine !== false }; }
  }

  const frameQuality = (media) => {
    try {
      const quality = typeof media?.getVideoPlaybackQuality === 'function' ? media.getVideoPlaybackQuality() : null;
      const total = Number(quality?.totalVideoFrames ?? media?.webkitDecodedFrameCount);
      const dropped = Number(quality?.droppedVideoFrames ?? media?.webkitDroppedFrameCount);
      return {
        totalVideoFrames: Number.isFinite(total) && total >= 0 ? total : null,
        droppedVideoFrames: Number.isFinite(dropped) && dropped >= 0 ? dropped : null,
        droppedFrameRatio: Number.isFinite(total) && total > 0 && Number.isFinite(dropped)
          ? Math.max(0, Math.min(1, dropped / total)) : null
      };
    } catch (_) { return { totalVideoFrames: null, droppedVideoFrames: null, droppedFrameRatio: null }; }
  };

  function snapshotMedia(media = player, role = media === player ? 'canonical-player' : 'media') {
    const snapshot = {
      role,
      sourceKey: sourceKey(media),
      readyState: Number(media?.readyState) || 0,
      networkState: Number(media?.networkState) || 0,
      currentTime: finite(media?.currentTime),
      duration: finite(media?.duration),
      videoWidth: Number(media?.videoWidth) || 0,
      videoHeight: Number(media?.videoHeight) || 0,
      bufferedRanges: getBufferedRanges(media),
      bufferedAheadSeconds: bufferedAheadSeconds(media),
      paused: !!media?.paused,
      ended: !!media?.ended,
      seeking: !!media?.seeking,
      muted: !!media?.muted,
      volume: finite(media?.volume),
      playbackRate: finite(media?.playbackRate),
      errorCode: Number(media?.error?.code) || 0
    };
    if (DEBUG) {
      snapshot.resourceTiming = resourceTiming(media);
      snapshot.connection = connectionSnapshot();
    }
    if (media === player) {
      Object.assign(snapshot, {
        version: state.version,
        sourceGeneration: state.sourceGeneration,
        sessions: state.sessions,
        playEvents: state.playEvents,
        firstFrameMs: state.firstFrameMs,
        startupMs: state.startupMs,
        canPlayMs: state.canPlayMs,
        waitingCount: state.waitingCount,
        stalledCount: state.stalledCount,
        errorCount: state.errorCount,
        lastErrorCode: state.lastErrorCode,
        totalWaitingMs: Math.round(state.totalWaitingMs + (state.currentWaitingSince ? now() - state.currentWaitingSince : 0)),
        ...frameQuality(media)
      });
    }
    return snapshot;
  }

  function dispatchDiagnostic(name, media, role, extra = {}) {
    try {
      window.dispatchEvent(new CustomEvent('egybook:playback-diagnostic', {
        detail: { event: name, role, snapshot: snapshotMedia(media, role), ...extra }
      }));
    } catch (_) {}
  }

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
  const publish = (name, extra = {}) => {
    markEvent();
    dispatchDiagnostic(name, player, 'canonical-player', extra);
  };
  const beginSource = () => {
    finishWaiting();
    sourceStartedAt = now();
    state.sourceGeneration += 1;
    state.firstFrameMs = null;
    state.startupMs = null;
    state.canPlayMs = null;
    state.currentWaitingSince = 0;
    hasPlayedCurrentSource = false;
    firstFramePending = false;
    publish('source-change');
  };
  const recordFirstFrame = () => {
    if (state.firstFrameMs !== null || firstFramePending) return;
    firstFramePending = true;
    const generation = state.sourceGeneration;
    const done = () => {
      if (!firstFramePending || generation !== state.sourceGeneration) return;
      firstFramePending = false;
      state.firstFrameMs = Math.round(Math.max(0, now() - sourceStartedAt));
      publish('first-frame');
    };
    if (typeof player.requestVideoFrameCallback === 'function') {
      try { player.requestVideoFrameCallback(done); return; } catch (_) {}
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
  };

  player.addEventListener('loadstart', beginSource, { passive: true });
  player.addEventListener('loadedmetadata', () => publish('loadedmetadata'), { passive: true });
  player.addEventListener('loadeddata', recordFirstFrame, { passive: true });
  player.addEventListener('canplay', () => {
    if (state.canPlayMs === null) state.canPlayMs = Math.round(Math.max(0, now() - sourceStartedAt));
    publish('canplay');
  }, { passive: true });
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
  player.addEventListener('progress', () => {
    if (!DEBUG) return;
    const at = now();
    if (at - lastPrimaryProgressAt < 350) return;
    lastPrimaryProgressAt = at;
    publish('progress');
  }, { passive: true });
  player.addEventListener('seeking', () => publish('seeking'), { passive: true });
  player.addEventListener('seeked', () => { markEvent(); publish('seeked'); }, { passive: true });
  player.addEventListener('suspend', () => publish('suspend'), { passive: true });
  player.addEventListener('error', () => {
    finishWaiting();
    state.errorCount += 1;
    state.lastErrorCode = Number(player.error?.code) || 0;
    publish('error');
  }, { passive: true });
  player.addEventListener('pause', () => { finishWaiting(); publish('pause'); }, { passive: true });
  player.addEventListener('ended', () => { finishWaiting(); publish('ended'); }, { passive: true });
  player.addEventListener('emptied', () => { finishWaiting(); publish('emptied'); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishWaiting(); }, { passive: true });

  function watchMedia(media, options = {}) {
    if (!DEBUG || !media || media === player || typeof media.addEventListener !== 'function') return () => {};
    const existing = watchedMedia.get(media);
    if (existing) {
      existing.meta = { ...existing.meta, ...options };
      return existing.cleanup;
    }
    const record = {
      meta: { role: 'reels-adjacent-preview', ...options },
      startedAt: now(),
      firstFrameMs: null,
      canPlayMs: null,
      playingMs: null,
      waitingCount: 0,
      stalledCount: 0,
      waitingSince: 0,
      totalWaitingMs: 0,
      lastProgressAt: 0,
      cleanup: null
    };
    const listeners = [];
    const emit = (eventName) => {
      const role = String(record.meta.role || 'reels-adjacent-preview');
      const snapshot = snapshotMedia(media, role);
      snapshot.loadToFirstDataMs = record.firstFrameMs;
      snapshot.loadToCanPlayMs = record.canPlayMs;
      snapshot.loadToPlayingMs = record.playingMs;
      snapshot.waitingCount = record.waitingCount;
      snapshot.stalledCount = record.stalledCount;
      snapshot.totalWaitingMs = Math.round(record.totalWaitingMs + (record.waitingSince ? now() - record.waitingSince : 0));
      dispatchDiagnostic(`preview-${eventName}`, media, role, { meta: { ...record.meta }, previewMetrics: {
        loadToFirstDataMs: record.firstFrameMs,
        loadToCanPlayMs: record.canPlayMs,
        loadToPlayingMs: record.playingMs,
        waitingCount: record.waitingCount,
        stalledCount: record.stalledCount,
        totalWaitingMs: snapshot.totalWaitingMs
      } });
    };
    const add = (type, handler) => {
      media.addEventListener(type, handler, { passive: true });
      listeners.push(() => media.removeEventListener(type, handler));
    };
    add('loadstart', () => {
      record.startedAt = now();record.firstFrameMs = null;record.canPlayMs = null;record.playingMs = null;
      record.waitingSince = 0;record.totalWaitingMs = 0;emit('loadstart');
    });
    add('loadedmetadata', () => emit('loadedmetadata'));
    add('loadeddata', () => {
      if (record.firstFrameMs === null) record.firstFrameMs = Math.round(Math.max(0, now() - record.startedAt));
      emit('loadeddata');
    });
    add('canplay', () => {
      if (record.canPlayMs === null) record.canPlayMs = Math.round(Math.max(0, now() - record.startedAt));
      emit('canplay');
    });
    add('canplaythrough', () => emit('canplaythrough'));
    add('playing', () => {
      if (record.playingMs === null) record.playingMs = Math.round(Math.max(0, now() - record.startedAt));
      if (record.waitingSince) { record.totalWaitingMs += Math.max(0, now() - record.waitingSince);record.waitingSince = 0; }
      emit('playing');
    });
    add('waiting', () => { record.waitingCount++;if (!record.waitingSince) record.waitingSince = now();emit('waiting'); });
    add('stalled', () => { record.stalledCount++;emit('stalled'); });
    add('progress', () => { const at = now();if (at - record.lastProgressAt < 350) return;record.lastProgressAt = at;emit('progress'); });
    add('seeking', () => emit('seeking'));
    add('seeked', () => emit('seeked'));
    add('suspend', () => emit('suspend'));
    add('error', () => emit('error'));
    add('pause', () => {
      if (record.waitingSince) { record.totalWaitingMs += Math.max(0, now() - record.waitingSince);record.waitingSince = 0; }
      emit('pause');
    });
    const cleanup = () => { while (listeners.length) { try { listeners.pop()(); } catch (_) {} }watchedMedia.delete(media); };
    record.cleanup = cleanup;
    watchedMedia.set(media, record);
    emit('watch-attached');
    return cleanup;
  }

  function unwatchMedia(media) {
    const record = media && watchedMedia.get(media);
    if (!record) return false;
    record.cleanup();
    return true;
  }

  function recordMedia(stage, media, meta = {}) {
    if (!DEBUG || !media) return false;
    dispatchDiagnostic(String(stage || 'media-snapshot'), media, String(meta.role || 'reels-adjacent-preview'), { meta: { ...meta } });
    return true;
  }

  window.EgyBookPlaybackMonitor = Object.freeze({
    version: 55,
    getSnapshot: () => snapshotMedia(player, 'canonical-player'),
    snapshotMedia,
    watchMedia,
    unwatchMedia,
    recordMedia,
    reset() {
      state.sessions = 0;state.playEvents = 0;state.firstFrameMs = null;state.startupMs = null;state.canPlayMs = null;
      state.waitingCount = 0;state.stalledCount = 0;state.errorCount = 0;state.lastErrorCode = 0;
      state.totalWaitingMs = 0;state.currentWaitingSince = 0;hasPlayedCurrentSource = false;
      sourceStartedAt = now();state.sourceGeneration += 1;firstFramePending = false;publish('reset');
      return snapshotMedia(player, 'canonical-player');
    }
  });
  publish('initialized');
})();
