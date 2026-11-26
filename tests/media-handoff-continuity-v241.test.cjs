'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const indicatorSource = fs.readFileSync(path.join(root, 'evp-video-network-indicator.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const coordinator = fs.readFileSync(path.join(root, 'egybook-reels-playback-coordinator.js'), 'utf8');

// Verify the handoff now freezes the live preview once and makes a single
// canonical seek assignment, rather than chasing the moving preview clock.
assert.doesNotMatch(main, /handoffResyncCount|player_handoff_live_resync_failed|player_handoff_frozen_resync_failed/,
  'the repeated live-resync seek loop is removed');
const applyStart = main.indexOf('const applyHandoffSeek=()=>{');
const applyEnd = main.indexOf('\n    };', applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'one-shot handoff seek function is present');
const applyBlock = main.slice(applyStart, applyEnd);
assert.match(applyBlock, /handoffSeekStarted/, 'the handoff seek is guarded against repeat execution');
assert.match(applyBlock, /freezeHandoffPreview\(\)[\s\S]*?const latest=liveHandoffTime\(\)/,
  'the preview is frozen before its final handoff time is sampled');
assert.equal((applyBlock.match(/player\.currentTime\s*=\s*safeTime/g) || []).length, 1,
  'the canonical player receives no more than one seek assignment in the handoff function');
assert.match(main, /listenTransition\(player,'playing'[\s\S]*?activateIncomingAudio\('playing-event'\)/,
  'incoming audio activation is attached to the media playing boundary');
assert.match(main, /activateIncomingAudio\('play-promise-fallback'\)/,
  'the play promise remains a fallback if the playing event is absent');
assert.match(main, /fadeInMs:0/, 'the Reels transition does not add a second incoming volume ramp');
assert.match(coordinator, /options\.fadeInMs === undefined \? 90 : Number\(options\.fadeInMs\)/,
  'the coordinator distinguishes an explicit zero fade from an omitted setting');
assert.match(main, /player_handoff_seek_started[\s\S]*?player_handoff_seek_completed/,
  'seek start and completion are separately observable in V241 diagnostics');
assert.match(main, /const KEY='egybook_video_diag_v241'/,
  'V241 diagnostic sessions use a separate key without deleting V240 history');
assert.match(main, /if\(reusePlayerSource&&player\.readyState>=1\)applyHandoffSeek\(\)/,
  'a reused canonical source does not wait for a metadata event that may not fire again');

class ClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class EventTargetFake {
  constructor() { this.listeners = Object.create(null); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  fire(type) { for (const fn of (this.listeners[type] || []).slice()) fn({ type, target: this }); }
}

// Minimal deterministic DOM/timer harness for the network indicator.
const timers = new Map();
let timerSequence = 0;
const timerWindow = {
  setTimeout(fn) { const id = ++timerSequence; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); }
};
const observers = [];
class MutationObserverFake {
  constructor(callback) { this.callback = callback; this.target = null; observers.push(this); }
  observe(target) { this.target = target; }
  disconnect() {}
}
const fireTimers = () => {
  const queued = [...timers.values()];
  timers.clear();
  queued.forEach(fn => fn());
};
const fireObserverFor = target => observers.filter(observer => observer.target === target).forEach(observer => observer.callback());

const modal = new EventTargetFake();
modal.dataset = { mediaKind: 'video' };
modal.hidden = false;
modal.classList = new ClassList();
modal.classList.add('open');
const video = new EventTargetFake();
video.readyState = 0;
video.paused = false;
video.ended = false;
video.error = null;
let readyCover = true;
let indicator = null;
const box = {
  querySelector(selector) {
    if (selector === '.evp-video-network-wait') return indicator;
    if (selector === '.evp-swipe-preview[data-preview-ready="1"]') return readyCover ? {} : null;
    return null;
  },
  append(node) { indicator = node; }
};
const document = {
  getElementById(id) {
    return id === 'egybookVideoModal' ? modal : id === 'egybookVideoBox' ? box : id === 'egybookVideoPlayer' ? video : null;
  },
  createElement() {
    return {
      classList: new ClassList(),
      attributes: Object.create(null),
      setAttribute(name, value) { this.attributes[name] = String(value); },
      innerHTML: ''
    };
  }
};
const sandbox = {
  window: timerWindow,
  document,
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3 },
  MutationObserver: MutationObserverFake,
  clearTimeout: timerWindow.clearTimeout,
  setTimeout: timerWindow.setTimeout
};
vm.runInNewContext(indicatorSource, sandbox);

// A decoded preview is already covering the canonical player's loading gap:
// no central spinner should appear until that cover is removed.
video.fire('loadstart');
assert.equal(timers.size, 0, 'ready preview cover suppresses the initial loading timer');
assert.equal(indicator.classList.contains('is-visible'), false, 'spinner stays hidden while decoded transition cover is visible');
readyCover = false;
fireObserverFor(box);
assert.equal(timers.size, 1, 'removing the cover re-evaluates the pending canonical load');
fireTimers();
assert.equal(indicator.classList.contains('is-visible'), true, 'real initial loading is shown after the cover leaves');

// During playback, genuine buffering is still surfaced when no ready preview
// is covering the player, and is suppressed/re-armed around a ready cover.
video.readyState = 2;
video.fire('playing');
assert.equal(indicator.classList.contains('is-visible'), false, 'playing clears the initial loading state');
video.fire('waiting');
assert.equal(timers.size, 1, 'buffering timer is scheduled without a ready cover');
fireTimers();
assert.equal(indicator.classList.contains('is-visible'), true, 'genuine buffering indicator remains functional');
readyCover = true;
fireObserverFor(box);
assert.equal(indicator.classList.contains('is-visible'), false, 'a newly ready cover hides the redundant central spinner');
readyCover = false;
fireObserverFor(box);
assert.equal(timers.size, 1, 'buffering wait is re-armed when the cover is removed');
fireTimers();
assert.equal(indicator.classList.contains('is-visible'), true, 'buffering is shown again if the canonical player still lacks future data');

assert.ok(html.includes('script.js?v=248-adaptive-render-concurrency'), 'HTML points to the V241 main script');
assert.ok(html.includes('evp-video-network-indicator.js?v=241-covered-handoff-wait'), 'HTML points to the V241 indicator logic');
assert.ok(sw.includes("const VERSION = '2026-11-egybook-v248-device-intelligence-adaptive-performance';"), 'Service Worker cache advances to V241');
assert.ok(sw.includes('evp-video-network-indicator.js?v=241-covered-handoff-wait'), 'Service Worker precaches the V241 indicator');

console.log('EgyBook V241 Media Handoff Continuity: PASS 25 assertions');
