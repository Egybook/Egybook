'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'egybook-performance-diagnostics.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, handler, options) { (this.listeners[type] ||= []).push({ handler, options }); }
  removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter(item => item.handler !== handler); }
  fire(type, extra = {}) { for (const item of (this.listeners[type] || []).slice()) item.handler({ type, target: this, ...extra }); }
}

function createEnv(search) {
  const window = new Target();
  const document = new Target();
  const body = new Target();
  body.dataset = { egybookActivePage: 'home' };
  body.appendChild = node => { node.parentNode = body; body.lastChild = node; };
  const rootEl = { appendChild: body.appendChild };
  document.body = body;
  document.documentElement = rootEl;
  document.hidden = false;
  document.createElement = tag => Object.assign(new Target(), { tagName: tag.toUpperCase(), style: {}, setAttribute() {}, click() { this.clicked = true; }, remove() { this.removed = true; } });
  document.getElementsByTagName = () => [];
  window.document = document;
  window.location = { search };
  window.innerWidth = 390; window.innerHeight = 844; window.devicePixelRatio = 2;
  window.screen = { width: 390, height: 844 };
  window.matchMedia = () => ({ matches: false });
  let clock = 10;
  const rafQueue = [];
  const performance = { now: () => clock, getEntriesByType: () => [] };
  const sandbox = {
    window, document, navigator: { platform: 'Android', hardwareConcurrency: 8, deviceMemory: 4 },
    performance, URLSearchParams, Date, Number, Math, Object, Array, String, Blob: class Blob { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    requestAnimationFrame: callback => { rafQueue.push(callback); return rafQueue.length; },
    cancelAnimationFrame() {}, setTimeout() {}, console: { info() {} },
    HTMLVideoElement: function HTMLVideoElement() {}
  };
  sandbox.HTMLVideoElement.prototype = {};
  sandbox.window.PerformanceObserver = undefined;
  return { sandbox, window, document, body, rafQueue, setClock: value => { clock = value; } };
}

// Disabled mode must not add listeners or create any UI.
{
  const env = createEnv('');
  vm.runInNewContext(source, env.sandbox);
  assert.equal(env.window.EgyBookPerfDiagnostics, undefined, 'diagnostics are completely inactive without opt-in query');
  assert.equal(env.body?.lastChild, undefined, 'no diagnostic badge is injected in normal app sessions');
  assert.equal(Object.keys(env.document.listeners).length, 0, 'no document event listeners are added when disabled');
}

// Enabled mode is passive, bounded, local-only, and downloadable.
{
  const env = createEnv('?egbPerfDebug=1&videoDebug=1');
  vm.runInNewContext(source, env.sandbox);
  const api = env.window.EgyBookPerfDiagnostics;
  assert.equal(api.version, 245, 'V245 diagnostics API is exposed only in opt-in mode');
  assert.ok(env.document.listeners.scroll?.[0]?.options?.passive, 'scroll observer is passive');
  assert.equal(env.document.listeners.scroll?.[0]?.options?.capture, true, 'nested scrolling is observed in capture phase');
  assert.ok(env.document.listeners.pointermove?.[0]?.options?.passive, 'pointer movement observer is passive');
  assert.equal(env.document.listeners.touchmove?.[0]?.options?.passive, true, 'touch movement observer is passive');

  env.document.fire('scroll');
  env.document.fire('pointerdown');
  env.window.fire('egybook:playback-diagnostic', { detail: { event: 'playing', role: 'preview', snapshot: {
    sourceKey: 'abcd1234', role: 'preview', currentTime: 0.4, bufferedAheadSeconds: 3,
    sourceUrl: 'https://media.example/reel.mp4?token=private-secret'
  } } });
  env.setClock(18);
  for (const callback of env.rafQueue.splice(0)) callback(18);
  const result = api.getReport();
  assert.equal(result.version, 245, 'report is versioned');
  assert.equal(result.scroll.eventCountsByTarget.document, 1, 'scroll target counts are recorded');
  assert.equal(result.input.counts.pointerdown, 1, 'pointer events are counted');
  assert.equal(result.privacy.noFullPageUrl, true, 'report explicitly excludes full page URL');
  assert.equal(result.privacy.noMediaUrl, true, 'report explicitly excludes full media URLs');
  assert.equal(result.playbackDiagnostics.events[0].sourceKey, 'abcd1234', 'media identity is represented only by its safe fingerprint');
  assert.equal(JSON.stringify(result).includes('private-secret'), false, 'diagnostic report excludes signed media URL tokens');
  assert.equal(JSON.stringify(result).includes('egbPerfDebug=1'), false, 'report does not include debug URL/query string');
  assert.equal(typeof api.exportReport, 'function', 'mobile report export method exists');
  assert.equal(api.stop(), true, 'diagnostics can be stopped and cleaned up');
  assert.equal(api.stop(), false, 'stop is idempotent');
}

assert.ok(html.includes('egybook-performance-diagnostics.js?v=245-touch-scroll-diagnostics'), 'index loads the V245 module with a versioned URL');
assert.ok(sw.includes('egybook-performance-diagnostics.js?v=245-touch-scroll-diagnostics'), 'Service Worker precaches the V245 module');
assert.ok(sw.includes("const VERSION = '2026-11-egybook-v245-touch-scroll-diagnostics'"), 'Service Worker cache generation advances');
assert.ok(!/\.topbar|\.bottom-navigation|topbar|bottom-navigation/.test(source), 'diagnostics do not target or mutate either navigation bar');
console.log('EgyBook V245 Touch & Scroll Diagnostics: PASS 19 assertions');
