/* EgyBook Adaptive Device & Runtime Performance Engine v246
 * Uses privacy-preserving browser capability hints, not a model-name database.
 * Runtime pressure is inferred from sustained Long Tasks; it is NOT a thermal sensor.
 * No polling loop, user-agent model fingerprinting, storage, or network requests.
 */
(() => {
  'use strict';
  if (window.EgyBookPerformance?.version === 246) return;

  const root = document.documentElement;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const memory = Number(navigator.deviceMemory) || 0;
  const cores = Number(navigator.hardwareConcurrency) || 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
    recentLongTasks: [],
    pressureUntil: 0,
    pressure: false,
    pressureTimer: 0,
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
      version: 246,
      mode: state.mode,
      deviceTier: state.deviceTier,
      signalConfidence: state.signalConfidence,
      memoryHint: state.memoryHint,
      coresHint: state.coresHint,
      saveData: state.saveData,
      reducedMotion: state.reducedMotion,
      pressure,
      pressureSignal: 'longtask-burst-not-temperature',
      pressureRemainingMs: pressure ? Math.max(0, Math.round(state.pressureUntil - now())) : 0,
      longTasks: state.longTasks,
      recentLongTasks: state.recentLongTasks.length,
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

  function recordLongTask(entry) {
    if (state.hidden || !entry || !(Number(entry.duration) > 50)) return;
    state.longTasks++;
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

  function applyBaseProfile() {
    state.reducedMotion = !!reducedMotion.matches;
    state.saveData = !!(connection && connection.saveData);
    const lowResource = state.deviceTier === 'L1' || state.saveData;
    state.mode = lowResource ? 'conserve' : 'balanced';
    // Keep the established root attribute semantics. Runtime pressure is exposed
    // separately so it cannot silently alter protected header/navigation styling.
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

  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) recordLongTask(entry);
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch (_) { /* Unsupported observer type: capability classification still works. */ }
  }

  window.EgyBookPerformance = Object.freeze({
    version: 246,
    classifyDevice,
    getSnapshot
  });
})();
