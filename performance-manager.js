/* EgyBook Universal Device Intelligence & Runtime Performance Engine v248
 * Privacy-preserving capability hints; no model-name fingerprinting or network collection.
 * Runtime pressure is inferred from Long Tasks (or a Long Animation Frame fallback),
 * never from device temperature. Device-memory and CPU values are browser hints, not exact specs.
 */
(() => {
  'use strict';
  if (window.EgyBookPerformance?.version === 248) return;

  const root = document.documentElement;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const memory = Number(navigator.deviceMemory) || 0;
  const cores = Number(navigator.hardwareConcurrency) || 0;
  const reducedMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {}, addListener() {} };
  const now = () => {
    const value = Number(performance?.now?.());
    return Number.isFinite(value) ? value : Date.now();
  };

  function classifyDevice(memoryHint, coreHint) {
    const hasMemory = memoryHint > 0;
    const hasCores = coreHint > 0;
    if ((hasMemory && memoryHint <= 2) || (hasCores && coreHint <= 4)) return 'L1';
    if ((hasMemory && memoryHint <= 4) || (hasCores && coreHint <= 6)) return 'L2';
    if (hasMemory && hasCores && memoryHint >= 8 && coreHint >= 12) return 'L4';
    if ((hasMemory && memoryHint >= 8 && (!hasCores || coreHint >= 8)) ||
        (hasCores && coreHint >= 8 && !hasMemory)) return 'L3';
    // Unknown or partial signals stay on a balanced baseline, never assumed flagship.
    return 'L2';
  }

  function detectRuntime() {
    const ua = String(navigator.userAgent || '');
    const platformHint = String(navigator.userAgentData?.platform || navigator.platform || '');
    const isAndroid = /android/i.test(ua) || /android/i.test(platformHint);
    const isIOS = /iphone|ipad|ipod/i.test(ua) ||
      (/mac/i.test(platformHint) && Number(navigator.maxTouchPoints) > 1);
    const isWindows = /windows/i.test(platformHint) || /windows/i.test(ua);
    const isMac = !isIOS && (/mac/i.test(platformHint) || /macintosh/i.test(ua));
    const isLinux = !isAndroid && /linux/i.test(platformHint || ua);
    const standalone = !!navigator.standalone || safeMatches('(display-mode: standalone)');
    const androidWebView = isAndroid && (/(?:\bwv\b|;\s*wv\))/i.test(ua) ||
      (/version\/[\d.]+.*chrome\/[\d.]+/i.test(ua) && /mobile/i.test(ua) && !/edg\//i.test(ua)));

    let platformFamily = 'unknown';
    if (isIOS) platformFamily = 'ios';
    else if (isAndroid) platformFamily = 'android';
    else if (isWindows) platformFamily = 'windows';
    else if (isMac) platformFamily = 'macos';
    else if (isLinux) platformFamily = 'linux';

    let browserFamily = 'unknown';
    if (/\bOPR\//i.test(ua) || /\bOpera\//i.test(ua) || /OPiOS/i.test(ua)) browserFamily = 'opera';
    else if (/EdgA?\//i.test(ua) || /EdgiOS/i.test(ua)) browserFamily = 'edge';
    else if (/SamsungBrowser\//i.test(ua)) browserFamily = 'samsung-internet';
    else if (/CriOS\//i.test(ua)) browserFamily = 'chrome-ios';
    else if (/FxiOS\//i.test(ua) || /Firefox\//i.test(ua)) browserFamily = 'firefox';
    else if (/Chrome\//i.test(ua)) browserFamily = androidWebView ? 'android-webview' : 'chrome';
    else if (/Safari\//i.test(ua)) browserFamily = 'safari';
    else if (androidWebView) browserFamily = 'android-webview';

    let runtimeType = 'unknown';
    if (isIOS) runtimeType = standalone ? 'ios-pwa' : 'ios-browser';
    else if (isAndroid && androidWebView) runtimeType = 'android-webview';
    else if (isAndroid) runtimeType = standalone ? 'android-pwa' : 'android-browser';
    else if (isWindows) runtimeType = standalone ? 'windows-pwa' : 'windows-browser';
    else if (isMac) runtimeType = standalone ? 'macos-pwa' : 'macos-browser';
    else if (isLinux) runtimeType = standalone ? 'linux-pwa' : 'linux-browser';

    return Object.freeze({
      platformFamily,
      browserFamily,
      runtimeType,
      appMode: standalone ? 'standalone' : 'browser',
      androidWebViewDetected: androidWebView,
      iosWebKitFamily: isIOS,
      userAgentDataAvailable: !!navigator.userAgentData
    });
  }

  function safeMatches(query) {
    try { return !!(typeof matchMedia === 'function' && matchMedia(query).matches); }
    catch (_) { return false; }
  }

  function readVideoFormatHints() {
    const result = { h264: 'unknown', vp9: 'unknown', av1: 'unknown', hevc: 'unknown' };
    try {
      const video = document.createElement?.('video');
      if (!video || typeof video.canPlayType !== 'function') return result;
      result.h264 = video.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'no';
      result.vp9 = video.canPlayType('video/webm; codecs="vp09.00.10.08"') || 'no';
      result.av1 = video.canPlayType('video/mp4; codecs="av01.0.05M.08"') || 'no';
      result.hevc = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') || 'no';
    } catch (_) {}
    return Object.freeze(result);
  }

  const runtime = detectRuntime();
  const capabilities = Object.freeze({
    deviceMemoryHint: memory > 0,
    hardwareConcurrencyHint: cores > 0,
    networkInformation: !!connection,
    performanceObserver: 'PerformanceObserver' in window,
    mediaCapabilities: !!navigator.mediaCapabilities,
    mediaSource: typeof window.MediaSource !== 'undefined',
    webCodecs: typeof window.VideoDecoder !== 'undefined',
    requestVideoFrameCallback: typeof window.HTMLVideoElement !== 'undefined' &&
      typeof window.HTMLVideoElement.prototype?.requestVideoFrameCallback === 'function',
    videoPlaybackQuality: typeof window.HTMLVideoElement !== 'undefined' &&
      typeof window.HTMLVideoElement.prototype?.getVideoPlaybackQuality === 'function',
    intersectionObserver: typeof window.IntersectionObserver !== 'undefined',
    resizeObserver: typeof window.ResizeObserver !== 'undefined',
    requestIdleCallback: typeof window.requestIdleCallback === 'function',
    offscreenCanvas: typeof window.OffscreenCanvas !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
    indexedDB: 'indexedDB' in window
  });
  const videoFormatHints = readVideoFormatHints();

  const deviceTier = classifyDevice(memory, cores);
  const signalConfidence = memory > 0 && cores > 0 ? 'two-hints' :
    (memory > 0 || cores > 0 ? 'one-hint' : 'no-hints');
  const state = {
    mode: 'balanced',
    deviceTier,
    signalConfidence,
    memoryHint: memory || null,
    coresHint: cores || null,
    saveData: !!(connection && connection.saveData),
    reducedMotion: !!reducedMotion.matches,
    startedAt: now(),
    longTasks: 0,
    pressureEvents: 0,
    recentLongTasks: [],
    pressureUntil: 0,
    pressure: false,
    pressureTimer: 0,
    pressureObserverSource: 'unsupported',
    hidden: !!document.hidden,
    lastForegroundAt: 0
  };

  const PRESSURE_WINDOW_MS = 15000;
  const PRESSURE_HOLD_MS = 25000;
  const PRESSURE_TASK_THRESHOLD = 3;

  function getPressure() {
    return !state.hidden && now() < state.pressureUntil;
  }

  function getSnapshot() {
    const pressure = getPressure();
    return {
      version: 248,
      mode: state.mode,
      deviceTier: state.deviceTier,
      signalConfidence: state.signalConfidence,
      memoryHint: state.memoryHint,
      coresHint: state.coresHint,
      runtime,
      capabilities,
      videoFormatHints,
      saveData: state.saveData,
      reducedMotion: state.reducedMotion,
      pressure,
      pressureSignal: state.pressureObserverSource === 'long-animation-frame'
        ? 'long-animation-frame-fallback-not-temperature'
        : state.pressureObserverSource === 'longtask'
          ? 'longtask-burst-not-temperature' : 'unavailable-not-temperature',
      pressureObserverSource: state.pressureObserverSource,
      pressureRemainingMs: pressure ? Math.max(0, Math.round(state.pressureUntil - now())) : 0,
      longTasks: state.longTasks,
      pressureEvents: state.pressureEvents,
      recentLongTasks: state.recentLongTasks.length,
      recentPressureEvents: state.recentLongTasks.length,
      elapsed: Math.round(now() - state.startedAt)
    };
  }

  function emitProfileChange(previousPressure) {
    const pressure = getPressure();
    root.dataset.egbPressure = pressure ? 'high' : 'normal';
    if (previousPressure !== pressure) {
      try {
        document.dispatchEvent(new CustomEvent('egybook:performance-profile-change', {
          detail: getSnapshot()
        }));
      } catch (_) {}
    }
    state.pressure = pressure;
  }

  function clearPressureTimer() {
    if (state.pressureTimer) clearTimeout(state.pressureTimer);
    state.pressureTimer = 0;
  }

  function schedulePressureExpiry() {
    clearPressureTimer();
    if (state.hidden || state.pressureUntil <= now()) {
      const previous = state.pressure;
      state.pressureUntil = 0;
      emitProfileChange(previous);
      return;
    }
    state.pressureTimer = setTimeout(() => {
      state.pressureTimer = 0;
      const previous = state.pressure;
      if (now() >= state.pressureUntil) state.pressureUntil = 0;
      emitProfileChange(previous);
      if (state.pressureUntil > now()) schedulePressureExpiry();
    }, Math.max(1, state.pressureUntil - now() + 25));
  }

  function recordPressureEntry(entry) {
    if (state.hidden || !entry || !(Number(entry.duration) > 50)) return;
    state.pressureEvents++;
    if (state.pressureObserverSource === 'longtask') state.longTasks++;
    const current = now();
    const start = Number.isFinite(Number(entry.startTime)) ? Number(entry.startTime) : current;
    const cutoff = current - PRESSURE_WINDOW_MS;
    state.recentLongTasks = state.recentLongTasks.filter(time => time >= cutoff);
    if (start >= cutoff && start <= current + 100) state.recentLongTasks.push(start);
    if (state.recentLongTasks.length > 20) state.recentLongTasks.splice(0, state.recentLongTasks.length - 20);
    if (state.recentLongTasks.length < PRESSURE_TASK_THRESHOLD) return;

    const previous = state.pressure;
    state.pressureUntil = Math.max(state.pressureUntil, current + PRESSURE_HOLD_MS);
    emitProfileChange(previous);
    schedulePressureExpiry();
  }

  function observePressureEntries() {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) recordPressureEntry(entry);
      });
      observer.observe({ type: 'longtask', buffered: true });
      state.pressureObserverSource = 'longtask';
      return;
    } catch (_) { /* Try the compatible frame fallback below. */ }

    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) recordPressureEntry(entry);
      });
      observer.observe({ type: 'long-animation-frame', buffered: true });
      state.pressureObserverSource = 'long-animation-frame';
    } catch (_) {
      state.pressureObserverSource = 'unsupported';
    }
  }

  function applyBaseProfile() {
    state.reducedMotion = !!reducedMotion.matches;
    state.saveData = !!(connection && connection.saveData);
    const lowResource = state.deviceTier === 'L1' || state.saveData;
    state.mode = lowResource ? 'conserve' : 'balanced';
    // Keep established root attribute semantics; pressure cannot alter protected headers.
    root.dataset.egbPerformance = (lowResource || state.reducedMotion) ? 'conserve' : 'balanced';
    root.dataset.egbMotion = state.reducedMotion ? 'reduced' : 'full';
    root.dataset.egbDeviceTier = state.deviceTier.toLowerCase();
    root.dataset.egbPressure = getPressure() ? 'high' : 'normal';
  }

  applyBaseProfile();
  const onMotionChange = () => {
    const previousMode = state.mode;
    const previousMotion = state.reducedMotion;
    applyBaseProfile();
    if (previousMode !== state.mode || previousMotion !== state.reducedMotion) {
      try { document.dispatchEvent(new CustomEvent('egybook:performance-profile-change', { detail: getSnapshot() })); } catch (_) {}
    }
  };
  if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', onMotionChange);
  else reducedMotion.addListener?.(onMotionChange);
  connection?.addEventListener?.('change', () => {
    const previousMode = state.mode;
    const previousSaveData = state.saveData;
    applyBaseProfile();
    if (previousMode !== state.mode || previousSaveData !== state.saveData) {
      try { document.dispatchEvent(new CustomEvent('egybook:performance-profile-change', { detail: getSnapshot() })); } catch (_) {}
    }
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    state.hidden = !!document.hidden;
    if (state.hidden) {
      state.lastForegroundAt = 0;
      state.recentLongTasks.length = 0;
      state.pressureUntil = 0;
      clearPressureTimer();
      const previous = state.pressure;
      emitProfileChange(previous);
    } else {
      state.lastForegroundAt = now();
      state.recentLongTasks.length = 0;
      state.pressureUntil = 0;
      const previous = state.pressure;
      emitProfileChange(previous);
    }
  }, { passive: true });

  observePressureEntries();

  window.EgyBookPerformance = Object.freeze({
    version: 248,
    classifyDevice,
    getSnapshot
  });
})();
