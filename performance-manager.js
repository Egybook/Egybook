/* EgyBook Performance Manager v158
 * Lightweight, local-only diagnostics. No network calls and no DOM rewriting.
 * Enable details with ?egbperf=1 or localStorage.egybook_perf_debug="1".
 */
(() => {
  'use strict';
  if (window.EgyBookPerformance) return;
  const state = { startedAt: performance.now(), metrics: {}, longTasks: 0, hiddenAt: 0 };
  const debug = (() => {
    try { return new URLSearchParams(location.search).get('egbperf') === '1' || localStorage.getItem('egybook_perf_debug') === '1'; }
    catch (_) { return false; }
  })();
  const report = (name, value) => {
    if (!Number.isFinite(value)) return;
    state.metrics[name] = Math.round(value * 100) / 100;
    if (debug) console.info('[EgyBook performance]', name, state.metrics[name]);
  };
  try {
    if ('PerformanceObserver' in window) {
      for (const [type, key, read] of [
        ['paint', 'first-paint', e => e.startTime],
        ['paint', 'first-contentful-paint', e => e.startTime],
        ['largest-contentful-paint', 'largest-contentful-paint', e => e.startTime],
        ['layout-shift', 'cumulative-layout-shift', e => e.value],
        ['longtask', 'long-tasks', e => e.duration]
      ]) {
        try {
          const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (key === 'long-tasks') { state.longTasks++; report(key, (state.metrics[key] || 0) + entry.duration); }
              else if (key === 'cumulative-layout-shift') { if (!entry.hadRecentInput) report(key, (state.metrics[key] || 0) + read(entry)); }
              else report(key, read(entry));
            }
          });
          observer.observe({ type, buffered: true });
        } catch (_) { /* Metric not supported by this browser. */ }
      }
    }
  } catch (_) {}
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (nav) report('dom-content-loaded', nav.domContentLoadedEventEnd);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.hiddenAt = performance.now();
    else if (state.hiddenAt) { report('last-background-duration', performance.now() - state.hiddenAt); state.hiddenAt = 0; }
  }, { passive: true });
  window.addEventListener('pagehide', () => {
    if (debug) console.info('[EgyBook performance] summary', { ...state.metrics, longTasks: state.longTasks });
  }, { once: true });
  window.EgyBookPerformance = Object.freeze({
    getSnapshot: () => ({ ...state.metrics, longTasks: state.longTasks, elapsed: Math.round((performance.now() - state.startedAt) * 100) / 100 }),
    debugEnabled: debug
  });
})();
