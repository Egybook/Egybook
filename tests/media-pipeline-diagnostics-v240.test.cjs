'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'egybook-playback-stability-monitor.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const swipe = fs.readFileSync(path.join(root, 'swipe-navigation.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== handler); }
  fire(type) { for (const handler of (this.listeners[type] || []).slice()) handler({ type, target: this }); }
}
class Media extends Target {
  constructor(src) {
    super();
    this.src = src;
    this.currentSrc = src;
    this.readyState = 0;
    this.networkState = 1;
    this.currentTime = 0;
    this.duration = 35;
    this.videoWidth = 720;
    this.videoHeight = 1280;
    this.buffered = { length: 1, start: () => 0, end: () => 5 };
    this.paused = true;
    this.ended = false;
    this.seeking = false;
    this.muted = true;
    this.volume = 1;
    this.playbackRate = 1;
    this.error = null;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }
  getAttribute(name) { return name === 'src' ? this.src : null; }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; }
  getVideoPlaybackQuality() { return { totalVideoFrames: 120, droppedVideoFrames: 2 }; }
}

(async () => {
  const events = [];
  const window = new Target();
  window.dispatchEvent = event => { events.push(event); return true; };
  const document = new Target();
  document.hidden = false;
  const primary = new Media('https://media.example/reel.mp4?token=private-signed-token');
  document.getElementById = id => id === 'egybookVideoPlayer' ? primary : null;
  const navigator = { onLine: true, connection: { effectiveType: '3g', downlink: 1.2, rtt: 380, saveData: false } };
  let clock = 100;
  const performance = {
    now: () => clock,
    getEntriesByName: () => [{ duration: 420, requestStart: 12, responseStart: 81, transferSize: 64000,
      encodedBodySize: 63000, decodedBodySize: 63000, nextHopProtocol: 'h2' }]
  };
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail || {}; } }
  const location = { search: '?videoDebug=1' };
  const sandbox = { window, document, navigator, performance, CustomEvent, location, URLSearchParams,
    Number, Math, Object, Array, String, Date, WeakMap, Promise,
    requestAnimationFrame: callback => { callback(0); return 1; } };
  vm.runInNewContext(source, sandbox);

  const monitor = window.EgyBookPlaybackMonitor;
  assert.equal(monitor.version, 55, 'passive monitor advances to V240 without replacing the player');
  const preview = new Media('https://media.example/reel.mp4?token=private-signed-token');
  const stop = monitor.watchMedia(preview, { role: 'reels-adjacent-warm-cache', priority: 'next' });
  assert.equal(typeof stop, 'function', 'preview observer returns a cleanup function');

  preview.readyState = 1;preview.fire('loadstart');
  clock += 95;preview.fire('loadedmetadata');
  preview.readyState = 2;clock += 140;preview.fire('loadeddata');
  clock += 35;preview.readyState = 3;preview.fire('canplay');
  preview.paused = false;clock += 70;preview.fire('playing');
  clock += 60;preview.fire('waiting');
  clock += 110;preview.fire('playing');

  const previewWaiting = events.find(event => event.type === 'egybook:playback-diagnostic' && event.detail.event === 'preview-waiting');
  assert.ok(previewWaiting, 'warm preview waiting event is published');
  assert.equal(previewWaiting.detail.snapshot.role, 'reels-adjacent-warm-cache', 'preview role is preserved');
  assert.equal(previewWaiting.detail.snapshot.bufferedAheadSeconds, 5, 'preview buffer ahead is measured');
  assert.equal(previewWaiting.detail.snapshot.resourceTiming.transferSize, 64000, 'available resource timing bytes are captured');
  assert.equal(previewWaiting.detail.snapshot.connection.effectiveType, '3g', 'network hints are captured with media events');
  assert.equal(previewWaiting.detail.previewMetrics.waitingCount, 1, 'preview wait events are counted');
  assert.ok(previewWaiting.detail.previewMetrics.loadToCanPlayMs >= 0, 'preview startup-to-canplay timing is captured');
  assert.match(previewWaiting.detail.snapshot.sourceKey, /^[0-9a-f]{8}$/, 'source is represented by a bounded fingerprint');
  assert.equal(JSON.stringify(previewWaiting.detail).includes('private-signed-token'), false, 'diagnostic event omits signed media URL');
  assert.equal(preview.playCalls, 0, 'monitor never starts preview playback');
  assert.equal(preview.pauseCalls, 0, 'monitor never pauses preview playback');

  const primarySnapshot = monitor.snapshotMedia(primary, 'canonical-player');
  assert.equal(primarySnapshot.role, 'canonical-player', 'canonical player snapshot remains available');
  assert.equal(primarySnapshot.videoHeight, 1280, 'media geometry is captured');
  assert.equal(primarySnapshot.droppedVideoFrames, 2, 'frame quality remains part of the diagnostic snapshot');
  monitor.recordMedia('preview-commit-requested', preview, { role: 'reels-swipe-preview', direction: 1 });
  assert.ok(events.some(event => event.detail.event === 'preview-commit-requested'), 'transition checkpoints can be recorded');
  stop();
  const countAfterStop = events.length;
  preview.fire('waiting');
  assert.equal(events.length, countAfterStop, 'preview listeners are removable after the observed lifecycle');

  assert.match(main, /egybook:playback-diagnostic/, 'exported video diagnostics collect passive pipeline events');
  assert.match(main, /reels_handoff_resource_pair/, 'canonical player and swipe preview resource states are correlated');
  assert.match(swipe, /watchMedia\?\.\(video/, 'adjacent warm-cache videos are observed before swipe use');
  assert.match(swipe, /preview-commit-requested/, 'swipe commit point is recorded without changing gesture policy');
  assert.ok(html.includes('script.js?v=247-profile-render-budget'), 'HTML uses the V240 main-script cache key');
  assert.ok(html.includes('egybook-playback-stability-monitor.js?v=55-v240-pipeline-diagnostics'), 'HTML loads the V240 passive diagnostics monitor');
  assert.ok(sw.includes("const VERSION = '2026-11-egybook-v247-render-and-reels-load';"), 'Service Worker cache advances to V240');
  assert.ok(sw.includes('script.js?v=247-profile-render-budget'), 'Service Worker precaches the V240 main script');

  console.log('EgyBook V240 Media Pipeline Diagnostics: PASS 26 assertions');
})().catch(error => { console.error(error); process.exitCode = 1; });
