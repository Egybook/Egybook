/* EgyBook Touch & Scroll Performance Diagnostics v248
 * Opt-in only: activate with ?egbPerfDebug=1 (and ?videoDebug=1 for Reels detail).
 * Passive measurements only. No playback control, layout writes, storage, network,
 * navigation changes, or application state mutation.
 */
(() => {
  'use strict';

  let enabled = false;
  try { enabled = new URLSearchParams(window.location.search).get('egbPerfDebug') === '1'; }
  catch (_) { enabled = false; }
  if (!enabled || window.EgyBookPerfDiagnostics?.version === 248) return;

  const MAX_SAMPLES = 600;
  const MAX_EVENTS = 100;
  const state = {
    startedAt: performance.now(),
    inputCounts: Object.create(null),
    scrollCounts: Object.create(null),
    inputToRaf: Object.create(null),
    frameIntervals: [],
    longTasks: [],
    eventTiming: [],
    longAnimationFrames: [],
    videoEvents: [],
    activityUntil: 0,
    lastFrameAt: 0,
    frameRaf: 0,
    stopped: false,
    observers: [],
    observerSupport: { longtask: false, eventTiming: false, longAnimationFrame: false },
    cleanup: []
  };

  const now = () => performance.now();
  const boundedPush = (array, value, limit = MAX_SAMPLES) => {
    array.push(value);
    if (array.length > limit) array.splice(0, array.length - limit);
  };
  const increment = (map, key) => { map[key] = (map[key] || 0) + 1; };
  const safeId = value => {
    const text = String(value || '');
    return /^[a-z][a-z0-9_-]{0,31}$/i.test(text) ? text : '';
  };
  const targetLabel = target => {
    if (target === document) return 'document';
    if (target === window) return 'window';
    if (target === document.documentElement) return 'html';
    if (target === document.body) return 'body';
    const tag = String(target?.tagName || target?.nodeName || 'unknown').toLowerCase().slice(0, 16);
    const id = safeId(target?.id);
    return id ? `${tag}#${id}` : tag;
  };
  const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] * 10) / 10;
  };
  const summarize = values => ({
    samples: values.length,
    meanMs: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null,
    p50Ms: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.round(Math.max(...values) * 10) / 10 : null
  });

  function armFrameSampling(duration = 1100) {
    if (state.stopped || document.hidden) return;
    state.activityUntil = Math.max(state.activityUntil, now() + duration);
    if (state.frameRaf) return;
    const tick = timestamp => {
      state.frameRaf = 0;
      if (state.stopped || document.hidden) { state.lastFrameAt = 0; return; }
      if (state.lastFrameAt) boundedPush(state.frameIntervals, Math.max(0, timestamp - state.lastFrameAt));
      state.lastFrameAt = timestamp;
      if (now() < state.activityUntil) state.frameRaf = requestAnimationFrame(tick);
      else state.lastFrameAt = 0;
    };
    state.frameRaf = requestAnimationFrame(tick);
  }

  const lastLatencyQueued = Object.create(null);
  function measureNextFrame(type, throttleMs = 0) {
    if (state.stopped || document.hidden) return;
    const at = now();
    if (throttleMs && at - (lastLatencyQueued[type] || 0) < throttleMs) return;
    lastLatencyQueued[type] = at;
    const bucket = state.inputToRaf[type] || (state.inputToRaf[type] = []);
    requestAnimationFrame(() => boundedPush(bucket, Math.max(0, now() - at), MAX_SAMPLES));
  }

  function onScroll(event) {
    increment(state.scrollCounts, targetLabel(event.target));
    armFrameSampling(1100);
    measureNextFrame('scroll', 80);
  }
  function onInput(event) {
    const type = String(event.type || 'input');
    increment(state.inputCounts, type);
    armFrameSampling(type.endsWith('move') || type === 'wheel' ? 800 : 350);
    measureNextFrame(type, type.endsWith('move') || type === 'wheel' ? 80 : 0);
  }
  function onVisibility() {
    if (document.hidden) {
      state.activityUntil = 0;
      state.lastFrameAt = 0;
      if (state.frameRaf) cancelAnimationFrame(state.frameRaf);
      state.frameRaf = 0;
    }
  }
  function onVideoDiagnostic(event) {
    const detail = event?.detail || {};
    const snapshot = detail.snapshot || {};
    boundedPush(state.videoEvents, {
      atMs: Math.round(now() - state.startedAt),
      event: String(detail.event || 'unknown').slice(0, 36),
      role: String(detail.role || snapshot.role || 'unknown').slice(0, 36),
      sourceKey: /^[a-f0-9]{8}$/i.test(String(snapshot.sourceKey || '')) ? snapshot.sourceKey : null,
      readyState: Number.isFinite(Number(snapshot.readyState)) ? Number(snapshot.readyState) : null,
      networkState: Number.isFinite(Number(snapshot.networkState)) ? Number(snapshot.networkState) : null,
      currentTime: Number.isFinite(Number(snapshot.currentTime)) ? Math.round(Number(snapshot.currentTime) * 10) / 10 : null,
      bufferedAheadSeconds: Number.isFinite(Number(snapshot.bufferedAheadSeconds)) ? Math.round(Number(snapshot.bufferedAheadSeconds) * 10) / 10 : null,
      paused: typeof snapshot.paused === 'boolean' ? snapshot.paused : null,
      errorCode: Number(snapshot.errorCode) || 0,
      firstFrameMs: Number.isFinite(Number(snapshot.firstFrameMs)) ? Number(snapshot.firstFrameMs) : null,
      startupMs: Number.isFinite(Number(snapshot.startupMs)) ? Number(snapshot.startupMs) : null,
      canPlayMs: Number.isFinite(Number(snapshot.canPlayMs)) ? Number(snapshot.canPlayMs) : null,
      waitingCount: Number.isFinite(Number(snapshot.waitingCount)) ? Number(snapshot.waitingCount) : null,
      stalledCount: Number.isFinite(Number(snapshot.stalledCount)) ? Number(snapshot.stalledCount) : null,
      totalWaitingMs: Number.isFinite(Number(snapshot.totalWaitingMs)) ? Number(snapshot.totalWaitingMs) : null,
      totalVideoFrames: Number.isFinite(Number(snapshot.totalVideoFrames)) ? Number(snapshot.totalVideoFrames) : null,
      droppedVideoFrames: Number.isFinite(Number(snapshot.droppedVideoFrames)) ? Number(snapshot.droppedVideoFrames) : null
    }, MAX_EVENTS);
  }

  function observe(type, handler, extra = {}) {
    if (!('PerformanceObserver' in window)) return false;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) handler(entry);
      });
      observer.observe({ type, buffered: true, ...extra });
      state.observers.push(observer);
      if (type === 'longtask' || type === 'event' || type === 'long-animation-frame') {
        state.observerSupport[type === 'event' ? 'eventTiming' : type === 'long-animation-frame' ? 'longAnimationFrame' : 'longtask'] = true;
      }
      return true;
    } catch (_) { return false; /* Unsupported entry type. */ }
  }

  observe('longtask', entry => boundedPush(state.longTasks, {
    startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration * 10) / 10,
    attribution: (entry.attribution || []).slice(0, 2).map(item => ({
      name: String(item.name || '').slice(0, 36), containerType: String(item.containerType || '').slice(0, 20)
    }))
  }, MAX_EVENTS));

  observe('event', entry => {
    const target = entry.target;
    boundedPush(state.eventTiming, {
      name: String(entry.name || '').slice(0, 24),
      durationMs: Math.round(entry.duration * 10) / 10,
      inputDelayMs: Number.isFinite(entry.processingStart) ? Math.round((entry.processingStart - entry.startTime) * 10) / 10 : null,
      processingMs: Number.isFinite(entry.processingEnd) && Number.isFinite(entry.processingStart)
        ? Math.round((entry.processingEnd - entry.processingStart) * 10) / 10 : null,
      target: targetLabel(target),
      interactionId: Number(entry.interactionId) || 0
    }, MAX_EVENTS);
  }, { durationThreshold: 16 });

  observe('long-animation-frame', entry => boundedPush(state.longAnimationFrames, {
    startMs: Math.round(entry.startTime),
    durationMs: Math.round(entry.duration * 10) / 10,
    blockingDurationMs: Number.isFinite(entry.blockingDuration) ? Math.round(entry.blockingDuration * 10) / 10 : null,
    styleAndLayoutMs: Number.isFinite(entry.styleAndLayoutStart) && Number.isFinite(entry.renderStart)
      ? Math.max(0, Math.round((entry.renderStart - entry.styleAndLayoutStart) * 10) / 10) : null,
    scripts: (entry.scripts || []).slice(0, 3).map(script => ({
      durationMs: Number.isFinite(script.duration) ? Math.round(script.duration * 10) / 10 : null,
      invokerType: String(script.invokerType || '').slice(0, 24),
      sourceFile: String(script.sourceURL || '').split('/').pop().split('?')[0].slice(0, 48)
    }))
  }, MAX_EVENTS));

  const listeners = [
    [document, 'scroll', onScroll, { capture: true, passive: true }],
    [document, 'pointerdown', onInput, { capture: true, passive: true }],
    [document, 'pointerup', onInput, { capture: true, passive: true }],
    [document, 'pointercancel', onInput, { capture: true, passive: true }],
    [document, 'pointermove', onInput, { capture: true, passive: true }],
    [document, 'touchstart', onInput, { capture: true, passive: true }],
    [document, 'touchend', onInput, { capture: true, passive: true }],
    [document, 'touchmove', onInput, { capture: true, passive: true }],
    [document, 'wheel', onInput, { capture: true, passive: true }],
    [document, 'visibilitychange', onVisibility, { passive: true }],
    [window, 'resize', onInput, { passive: true }],
    [window, 'egybook:playback-diagnostic', onVideoDiagnostic, { passive: true }]
  ];
  for (const [target, type, handler, options] of listeners) {
    target.addEventListener(type, handler, options);
    state.cleanup.push(() => target.removeEventListener(type, handler, options.capture === true));
  }

  const report = () => {
    const intervals = state.frameIntervals;
    const media = window.EgyBookPlaybackMonitor;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const nav = performance.getEntriesByType?.('navigation')?.[0] || null;
    return {
      product: 'EgyBook', version: 248, kind: 'opt-in-performance-diagnostics',
      generatedAt: new Date().toISOString(), durationMs: Math.round(now() - state.startedAt),
      privacy: { noFullPageUrl: true, noMediaUrl: true, noAccountData: true, localOnly: true },
      environment: {
        viewport: { width: Number(window.innerWidth) || 0, height: Number(window.innerHeight) || 0,
          screenWidth: Number(window.screen?.width) || 0, screenHeight: Number(window.screen?.height) || 0,
          devicePixelRatio: Number(window.devicePixelRatio) || 1 },
        memoryHintGb: Number(navigator.deviceMemory) || null,
        logicalCoresHint: Number(navigator.hardwareConcurrency) || null,
        platform: String(navigator.userAgentData?.platform || navigator.platform || 'unknown').slice(0, 24),
        effectiveConnectionType: String(connection?.effectiveType || 'unknown'),
        downlinkMbps: Number.isFinite(Number(connection?.downlink)) ? Number(connection.downlink) : null,
        saveData: !!connection?.saveData,
        reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
        visibility: document.hidden ? 'hidden' : 'visible',
        activePage: String(document.body?.dataset?.egybookActivePage || 'unknown').slice(0, 24)
      },
      deviceCapabilityProfile: (() => {
        try {
          const profile = window.EgyBookPerformance?.getSnapshot?.() || null;
          return profile ? {
            tier: profile.deviceTier || 'unknown',
            confidence: profile.signalConfidence || 'unknown',
            memoryHintGb: profile.memoryHint || null,
            logicalCoresHint: profile.coresHint || null,
            runtime: profile.runtime || null,
            capabilities: profile.capabilities || null,
            videoFormatHints: profile.videoFormatHints || null,
            pressureObserverSource: profile.pressureObserverSource || 'unknown'
          } : null;
        } catch (_) { return null; }
      })(),
      performanceProfile: (() => { try { return window.EgyBookPerformance?.getSnapshot?.() || null; } catch (_) { return null; } })(),
      startup: nav ? { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadEventMs: Math.round(nav.loadEventEnd) } : null,
      input: { counts: { ...state.inputCounts }, inputToNextAnimationFrame: Object.fromEntries(
        Object.entries(state.inputToRaf).map(([key, values]) => [key, summarize(values)])
      ) },
      scroll: { eventCountsByTarget: { ...state.scrollCounts }, frameIntervals: summarize(intervals),
        estimatedFrameRateFromRaf: percentile(intervals, 0.50) ? Math.round(1000 / percentile(intervals, 0.50) * 10) / 10 : null,
        intervalsOver33ms: intervals.filter(value => value > 33).length,
        intervalsOver50ms: intervals.filter(value => value > 50).length,
        intervalsOver100ms: intervals.filter(value => value > 100).length },
      longTasks: state.longTasks.slice(),
      eventTiming: state.eventTiming.slice(),
      longAnimationFrames: state.longAnimationFrames.slice(),
      playbackDiagnostics: { monitorVersion: Number(media?.version) || null, previewDetailRequiresVideoDebug: true, events: state.videoEvents.slice() },
      capabilities: { performanceObserver: 'PerformanceObserver' in window,
        longTaskObserver: state.observerSupport.longtask, eventTimingObserver: state.observerSupport.eventTiming,
        longAnimationFrameObserver: state.observerSupport.longAnimationFrame,
        requestVideoFrameCallback: typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype?.requestVideoFrameCallback === 'function' }
    };
  };

  function exportReport() {
    const data = report();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `EgyBook_V248_Performance_${Date.now()}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return data;
  }

  const dock = document.createElement('button');
  dock.type = 'button';
  dock.id = 'egb-v248-performance-export';
  dock.textContent = 'تقرير الأداء';
  dock.setAttribute('aria-label', 'تصدير تقرير أداء EgyBook');
  dock.style.cssText = [
    'position:fixed', 'left:10px', 'bottom:calc(env(safe-area-inset-bottom, 0px) + 88px)',
    'z-index:2147483000', 'border:1px solid rgba(0,217,255,.55)', 'border-radius:999px',
    'padding:9px 13px', 'background:rgba(7,18,40,.94)', 'color:#fff',
    'font:600 12px/1.2 system-ui,sans-serif', 'box-shadow:0 3px 14px rgba(0,0,0,.22)',
    'touch-action:manipulation', '-webkit-tap-highlight-color:transparent'
  ].join(';');
  dock.addEventListener('click', exportReport);
  (document.body || document.documentElement).appendChild(dock);
  state.cleanup.push(() => dock.remove());

  window.EgyBookPerfDiagnostics = Object.freeze({
    version: 248,
    getReport: report,
    exportReport,
    stop() {
      if (state.stopped) return false;
      state.stopped = true;
      if (state.frameRaf) cancelAnimationFrame(state.frameRaf);
      state.frameRaf = 0;
      state.observers.forEach(observer => { try { observer.disconnect(); } catch (_) {} });
      state.observers.length = 0;
      while (state.cleanup.length) { try { state.cleanup.pop()(); } catch (_) {} }
      return true;
    }
  });
  console.info('[EgyBook V248] Performance diagnostics enabled. Export with the floating report button or window.EgyBookPerfDiagnostics.getReport().');
})();
