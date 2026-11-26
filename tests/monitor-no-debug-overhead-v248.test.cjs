'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'egybook-playback-stability-monitor.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  fire(type) { for (const handler of (this.listeners[type] || []).slice()) handler({ type, target: this }); }
}
const events = [];
const window = new Target();
window.dispatchEvent = event => { events.push(event); return true; };
const document = new Target();
document.hidden = false;
const player = new Target();
Object.assign(player, {
  readyState: 2, networkState: 1, currentTime: 1.5, duration: 20, videoWidth: 720, videoHeight: 1280,
  paused: false, ended: false, seeking: false, muted: true, volume: 1, playbackRate: 1, error: null,
  buffered: { length: 1, start: () => 0, end: () => 4 },
  getVideoPlaybackQuality: () => ({ totalVideoFrames: 100, droppedVideoFrames: 1 })
});
document.getElementById = id => id === 'egybookVideoPlayer' ? player : null;
let clock = 100;
const CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail || {}; } };
vm.runInNewContext(source, {
  window, document, navigator: { onLine: true }, performance: { now: () => clock }, CustomEvent,
  location: { search: '' }, URLSearchParams, Number, Math, Object, Array, String, Date, WeakMap, Promise,
  requestAnimationFrame: callback => { callback(0); return 1; }
});
const monitor = window.EgyBookPlaybackMonitor;
assert.equal(monitor.version, 56);
player.fire('loadstart');
clock += 120;
player.fire('waiting');
assert.equal(monitor.getSnapshot().waitingCount, 1, 'internal playback state keeps updating');
assert.equal(events.length, 0, 'no detailed diagnostic events are dispatched in normal sessions');
assert.equal(player.playCalls || 0, 0, 'monitor does not control playback');
console.log('EgyBook V248 monitor opt-in overhead guard: PASS');
