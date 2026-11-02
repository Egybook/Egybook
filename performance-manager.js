/* EgyBook Adaptive Performance Manager v160
 * Best-effort device adaptation; never claims to set the physical display refresh rate.
 */
(() => {
  'use strict';
  if (window.EgyBookPerformance?.version === 160) return;
  const root = document.documentElement;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const memory = Number(navigator.deviceMemory) || 0;
  const cores = Number(navigator.hardwareConcurrency) || 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = !!(connection && connection.saveData);
  const lowResource = (memory > 0 && memory <= 2) || (cores > 0 && cores <= 4) || saveData;
  const state = { mode: lowResource ? 'conserve' : 'balanced', memoryHint: memory || null, coresHint: cores || null, saveData, reducedMotion: reducedMotion.matches, startedAt: performance.now(), longTasks: 0, metrics: {} };
  function apply() {
    state.reducedMotion = reducedMotion.matches;
    root.dataset.egbPerformance = (lowResource || state.reducedMotion) ? 'conserve' : 'balanced';
    root.dataset.egbMotion = state.reducedMotion ? 'reduced' : 'full';
  }
  apply();
  reducedMotion.addEventListener?.('change', apply);
  connection?.addEventListener?.('change', () => { state.saveData = !!connection.saveData; apply(); });
  document.addEventListener('visibilitychange', () => {
    state.hidden = document.hidden;
    if (!document.hidden) state.lastForegroundAt = performance.now();
  }, { passive: true });
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.duration > 50) state.longTasks++;
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  }
  window.EgyBookPerformance = Object.freeze({
    version: 160,
    getSnapshot: () => ({ mode: state.mode, conserve: root.dataset.egbPerformance === 'conserve', memoryHint: state.memoryHint, coresHint: state.coresHint, saveData: state.saveData, reducedMotion: state.reducedMotion, longTasks: state.longTasks, elapsed: Math.round(performance.now() - state.startedAt) })
  });
})();
