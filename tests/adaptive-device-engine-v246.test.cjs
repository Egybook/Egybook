'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const managerSource = fs.readFileSync(path.join(root, 'performance-manager.js'), 'utf8');
const adaptationSource = fs.readFileSync(path.join(root, 'egybook-video-adaptation.js'), 'utf8');
const dataSaverSource = fs.readFileSync(path.join(root, 'egybook-data-saver.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'responsive-optimization.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, options }); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(x => x.fn !== fn); }
  dispatchEvent(event) { for (const item of (this.listeners[event.type] || []).slice()) item.fn(event); return true; }
  fire(type, extra = {}) { return this.dispatchEvent({ type, target: this, ...extra }); }
}

function createEnv({ memory = 8, cores = 8, saveData = false, observer = true, effectiveType = '4g' } = {}) {
  let clock = 100;
  let nextTimer = 1;
  const timers = new Map();
  const window = new Target();
  const document = new Target();
  document.hidden = false;
  document.documentElement = { dataset: {} };
  const connection = new Target();
  Object.assign(connection, { saveData, effectiveType, rtt: 40, downlink: 10 });
  const mediaQuery = new Target();
  mediaQuery.matches = false;
  const mockNavigator = {
    deviceMemory: memory, hardwareConcurrency: cores, connection,
    onLine: true, platform: 'Android'
  };
  class MockPerformanceObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; MockPerformanceObserver.instances.push(this); }
    observe(options) { this.options = options; }
    disconnect() { this.disconnected = true; }
    emit(entries) { this.callback({ getEntries: () => entries }); }
  }
  MockPerformanceObserver.instances = [];
  if (observer) window.PerformanceObserver = MockPerformanceObserver;
  class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const sandbox = {
    window, document, navigator: mockNavigator,
    performance: { now: () => clock },
    matchMedia: () => mediaQuery,
    CustomEvent: CustomEventMock,
    PerformanceObserver: observer ? MockPerformanceObserver : undefined,
    setTimeout(fn, delay = 0) { const id = nextTimer++; timers.set(id, { fn, at: clock + Math.max(0, delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Number, Math, Date, Object, Array, String, Promise,
    console: { info() {} }
  };
  vm.runInNewContext(managerSource, sandbox, { filename: 'performance-manager.js' });
  return {
    window, document, connection, mediaQuery, sandbox,
    get clock() { return clock; },
    observer: MockPerformanceObserver.instances[0] || null,
    setClock(value) { clock = value; },
    advance(ms) {
      clock += ms;
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= clock) { timers.delete(id); timer.fn(); progressed = true; }
        }
      }
    }
  };
}

// Capability tiers are heuristic; missing browser hints never crash or assume flagship hardware.
{
  const env = createEnv({ memory: 2, cores: 4 });
  const api = env.window.EgyBookPerformance;
  assert.equal(api.version, 246);
  assert.equal(api.getSnapshot().deviceTier, 'L1');
  assert.equal(env.document.documentElement.dataset.egbDeviceTier, 'l1');
  assert.equal(env.document.documentElement.dataset.egbPerformance, 'conserve');
  assert.equal(api.classifyDevice(4, 6), 'L2');
  assert.equal(api.classifyDevice(8, 8), 'L3');
  assert.equal(api.classifyDevice(8, 12), 'L4');
}

{
  const env = createEnv({ memory: 4, cores: 6 });
  assert.equal(env.window.EgyBookPerformance.getSnapshot().deviceTier, 'L2');
  assert.equal(env.document.documentElement.dataset.egbPerformance, 'balanced');
}

{
  const env = createEnv({ memory: 0, cores: 0, observer: false });
  const snapshot = env.window.EgyBookPerformance.getSnapshot();
  assert.equal(snapshot.deviceTier, 'L2', 'unknown devices use a balanced fallback');
  assert.equal(snapshot.signalConfidence, 'no-hints');
  assert.equal(snapshot.pressure, false, 'absence of Long Task API does not break the engine');
}

// Three long tasks in a 15-second window activate temporary pressure mode, then it clears.
{
  const env = createEnv({ memory: 8, cores: 8 });
  assert.ok(env.observer, 'Long Task observer is registered when supported');
  env.observer.emit([
    { startTime: 110, duration: 65 },
    { startTime: 120, duration: 83 },
    { startTime: 135, duration: 101 }
  ]);
  let snapshot = env.window.EgyBookPerformance.getSnapshot();
  assert.equal(snapshot.pressure, true);
  assert.equal(snapshot.longTasks, 3);
  assert.equal(env.document.documentElement.dataset.egbPressure, 'high');
  env.advance(25100);
  snapshot = env.window.EgyBookPerformance.getSnapshot();
  assert.equal(snapshot.pressure, false, 'pressure expires after the quiet window');
  assert.equal(env.document.documentElement.dataset.egbPressure, 'normal');
}

// Hidden tabs discard stale pressure samples and do not classify background work as active load.
{
  const env = createEnv();
  env.document.hidden = true;
  env.document.fire('visibilitychange');
  env.observer.emit([
    { startTime: 110, duration: 90 },
    { startTime: 120, duration: 90 },
    { startTime: 130, duration: 90 }
  ]);
  assert.equal(env.window.EgyBookPerformance.getSnapshot().pressure, false);
  env.document.hidden = false;
  env.document.fire('visibilitychange');
  assert.equal(env.window.EgyBookPerformance.getSnapshot().pressure, false);
}

// The existing adjacent-video policy consumes the shared device profile and runtime pressure.
{
  const env = createEnv({ memory: 8, cores: 12 });
  vm.runInNewContext(adaptationSource, env.sandbox, { filename: 'egybook-video-adaptation.js' });
  assert.equal(env.window.EgyBookVideoAdaptation.version, 247);
  assert.equal(env.window.EgyBookVideoAdaptation.getPolicy().preload, 'auto');
  env.observer.emit([
    { startTime: 110, duration: 70 },
    { startTime: 120, duration: 70 },
    { startTime: 130, duration: 70 }
  ]);
  const policy = env.window.EgyBookVideoAdaptation.getPolicy();
  assert.equal(policy.runtimePressure, true);
  assert.equal(policy.preload, 'metadata');
  assert.equal(policy.tier, 'conservative');
}

// Under load, non-active feed media is deprioritized while the active video keeps its priority.
{
  const env = createEnv({ memory: 8, cores: 12 });
  const store = new Map();
  env.sandbox.localStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)) };
  env.window.EgyBookPerformance = { getSnapshot: () => ({ pressure: true }) };
  vm.runInNewContext(dataSaverSource, env.sandbox, { filename: 'egybook-data-saver.js' });
  assert.equal(env.window.EgyBookDataSaver.version, 246);
  const preview = { dataset: {}, preload: '', fetchPriority: '' };
  env.window.EgyBookDataSaver.applyVideoHints(preview, { near: true, active: false });
  assert.equal(preview.fetchPriority, 'low', 'non-active preview is deprioritized during runtime pressure');
  assert.equal(preview.preload, 'metadata', 'existing near-preview metadata behavior is preserved');
  const active = { dataset: {}, preload: '', fetchPriority: '' };
  env.window.EgyBookDataSaver.applyVideoHints(active, { near: true, active: true });
  assert.equal(active.fetchPriority, 'high', 'active playback retains high fetch priority');
  assert.equal(active.preload, 'auto', 'active playback retains automatic preload');
}

// Pressure styling must not target either protected navigation bar.
{
  const block = css.slice(css.indexOf('/* V246: temporary visual-load relief'), css.length);
  assert.ok(block.includes('data-egb-pressure="high"'));
  assert.ok(block.includes('.post') && block.includes('.section') && block.includes('.create-post'));
  assert.equal(/\.topbar|\.bottom-navigation|topbar|bottom-navigation/.test(block), false);
}

// HTML and Service Worker must load the matching versioned modules and cache generation.
assert.ok(html.includes('performance-manager.js?v=246-adaptive-device-engine'));
assert.ok(html.includes('egybook-performance-diagnostics.js?v=246-adaptive-device-diagnostics'));
assert.ok(html.includes('responsive-optimization.css?v=162-adaptive-load-pressure'));
assert.ok(html.includes('egybook-data-saver.js?v=246-load-aware-priority'));
assert.ok(html.includes('egybook-video-adaptation.js?v=247-unified-adjacent-preload'));
assert.ok(sw.includes("const VERSION = '2026-11-egybook-v247-render-and-reels-load'"));
assert.ok(sw.includes('performance-manager.js?v=246-adaptive-device-engine'));
assert.ok(sw.includes('responsive-optimization.css?v=162-adaptive-load-pressure'));
assert.ok(sw.includes('egybook-video-adaptation.js?v=247-unified-adjacent-preload'));
console.log('EgyBook V246 runtime engine + V247 preload bridge: PASS 30 assertions');
