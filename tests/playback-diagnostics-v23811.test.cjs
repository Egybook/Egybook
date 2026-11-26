'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'egybook-playback-stability-monitor.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.listeners[type] || []) handler({ type, target: this }); }
}
const events = [];
const window = new Target();
window.dispatchEvent = event => { events.push(event); return true; };
window.EgyBookPerfDiagnostics = { version: 248 };
const document = new Target();
document.hidden = false;
const player = new Target();
Object.assign(player, {
  readyState: 3, networkState: 1, currentTime: 10, duration: 90,
  videoWidth: 720, videoHeight: 1624, paused: false, ended: false,
  error: null, webkitDecodedFrameCount: 0, webkitDroppedFrameCount: 0,
  buffered: { length: 1, start: () => 0, end: () => 13.5 },
  getVideoPlaybackQuality: () => ({ totalVideoFrames: 450, droppedVideoFrames: 5 }),
  requestVideoFrameCallback(callback) { this.pendingFrame = callback; return 1; }
});
let playCalls = 0, pauseCalls = 0;
player.play = () => { playCalls++; player.paused = false; return Promise.resolve(); };
player.pause = () => { pauseCalls++; player.paused = true; };
document.getElementById = id => id === 'egybookVideoPlayer' ? player : null;
let clock = 100;
const performance = { now: () => clock };
class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }

vm.runInNewContext(source, { window, document, performance, CustomEvent, Number, Math, Object, Date, requestAnimationFrame: fn => fn() });
const monitor = window.EgyBookPlaybackMonitor;
assert.equal(monitor.version, 56, 'monitor version advances without replacing the player');
player.fire('loadstart');
clock += 120;
player.fire('loadeddata');
player.pendingFrame?.(0, { mediaTime: 0.04 });
clock += 80;
player.fire('waiting');
let snapshot = monitor.getSnapshot();
assert.equal(snapshot.videoWidth, 720, 'diagnostics expose the source width');
assert.equal(snapshot.videoHeight, 1624, 'diagnostics expose the source height');
assert.equal(snapshot.totalVideoFrames, 450, 'diagnostics read the browser playback frame counter');
assert.equal(snapshot.droppedVideoFrames, 5, 'diagnostics read dropped video frames');
assert.ok(Math.abs(snapshot.droppedFrameRatio - (5 / 450)) < 1e-8, 'dropped-frame ratio is calculated safely');
assert.equal(snapshot.bufferedAheadSeconds, 3.5, 'buffered-ahead time is measured around the playhead');
assert.equal(snapshot.waitingCount, 1, 'waiting events are counted');
const waitingEvent = events.find(event => event.type === 'egybook:playback-diagnostic' && event.detail.event === 'waiting');
assert.ok(waitingEvent, 'performance diagnostics receive a lightweight waiting event');
assert.equal(waitingEvent.detail.snapshot.bufferedRanges, undefined, 'performance-only events avoid expensive buffer-range snapshots');
assert.equal(waitingEvent.detail.snapshot.droppedVideoFrames, undefined, 'full decoded-frame sampling remains opt-in to videoDebug');
clock += 120;
player.fire('playing');
snapshot = monitor.getSnapshot();
assert.ok(snapshot.totalWaitingMs >= 120, 'waiting duration is tracked through resume');
assert.equal(playCalls, 0, 'the passive monitor never starts playback');
assert.equal(pauseCalls, 0, 'the passive monitor never pauses playback');
assert.ok(html.includes('egybook-playback-stability-monitor.js?v=56-opt-in-snapshot-overhead'), 'HTML loads the diagnostics build');
assert.ok(sw.includes('egybook-playback-stability-monitor.js?v=56-opt-in-snapshot-overhead'), 'Service Worker caches the same diagnostics build');

console.log('V240 Playback Diagnostics: PASS 13 assertions');
