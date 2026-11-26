const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-video-transition-guard.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, detail = {}) {
    for (const handler of Array.from(this.listeners.get(type) || [])) handler({ type, ...detail });
  }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

function setup() {
  let nextFrame = 0;
  const rafQueue = new Map();
  const window = {
    requestAnimationFrame(callback) { const id = ++nextFrame; rafQueue.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafQueue.delete(id); }
  };
  const flushRaf = () => {
    let guard = 0;
    while (rafQueue.size && guard++ < 20) {
      const [id, callback] = rafQueue.entries().next().value;
      rafQueue.delete(id);
      callback(guard * 16);
    }
  };
  vm.runInNewContext(moduleSource, { window, WeakMap, Set, Map, Array, String, Number, Object, encodeURIComponent });
  const player = new FakeTarget();
  player.dataset = {};
  player.readyState = 0;
  player.videoWidth = 0;
  player.videoHeight = 0;
  player.currentTime = 0;
  player.seeking = false;
  player.error = null;
  player.requestVideoFrameCallback = callback => { player.frameCallback = callback; return 1; };
  player.cancelVideoFrameCallback = () => { player.frameCallback = null; };
  player.fireFrame = mediaTime => { const callback = player.frameCallback; player.frameCallback = null; callback?.(0, { mediaTime }); };
  return { api: window.EgyBookVideoTransitionGuardV233, player, flushRaf };
}

(async () => {
  const x = setup();
  assert.strictEqual(x.api.version, '234.0', 'transition guard has a dedicated version');
  const first = x.api.begin(x.player, {}, '/media/first.mp4');
  let firstCalls = 0;
  x.api.listen(first, x.player, 'loadeddata', () => firstCalls++);
  assert.strictEqual(x.api.isCurrent(first), true, 'new player lease is current');
  assert.strictEqual(x.player.dataset.egybookTransitionSource, '/media/first.mp4', 'lease binds the exact source request');

  const second = x.api.begin(x.player, {}, '/media/second.mp4');
  let secondCalls = 0;
  x.api.listen(second, x.player, 'loadeddata', () => secondCalls++);
  x.player.dispatch('loadeddata');
  assert.strictEqual(firstCalls, 0, 'superseded source listeners are removed');
  assert.strictEqual(secondCalls, 1, 'only the newest source listener receives events');
  assert.strictEqual(x.api.isCurrent(first), false, 'older lease cannot mutate current player');
  assert.strictEqual(x.api.isCurrent(second), true, 'newer lease remains valid');

  let cancelled = 0;
  x.api.onCancel(second, () => cancelled++);
  assert.strictEqual(x.api.cancel(x.player, 'close'), true, 'close invalidates current lease');
  assert.strictEqual(cancelled, 1, 'cancellation hooks run exactly once');
  assert.strictEqual(x.api.isCurrent(second), false, 'cancelled lease is no longer current');
  x.player.dispatch('loadeddata');
  assert.strictEqual(secondCalls, 1, 'cancelled listener cannot receive later media events');

  const third = x.api.begin(x.player, {}, '/media/third.mp4');
  let presented = 0;
  x.player.readyState = 1;
  x.player.videoWidth = 720;
  x.player.videoHeight = 1280;
  x.player.currentTime = 3;
  x.api.watchPresentedFrame(third, { minimumTime: 5, onPresented: () => presented++ });
  x.player.dispatch('loadeddata');
  assert.strictEqual(presented, 0, 'metadata/low readiness and a playhead before target cannot uncover the player');
  x.player.readyState = 2;
  x.player.currentTime = 4.7;
  x.player.dispatch('timeupdate');
  x.player.fireFrame(4.6);
  assert.strictEqual(presented, 0, 'a compositor frame before the handoff timestamp is rejected');
  x.player.currentTime = 5.0;
  x.player.dispatch('timeupdate');
  x.player.fireFrame(5.0);
  assert.strictEqual(presented, 1, 'the matching decoded/presented frame releases the cover');
  x.player.dispatch('timeupdate');
  assert.strictEqual(presented, 1, 'frame release callback is one-shot');

  const fourth = x.api.begin(x.player, {}, '/media/fourth.mp4');
  let stalePresented = 0;
  x.player.readyState = 2; x.player.currentTime = 0;
  x.api.watchPresentedFrame(fourth, { onPresented: () => stalePresented++ });
  x.api.cancel(x.player, 'rapid-close');
  x.player.dispatch('playing');
  x.flushRaf();
  assert.strictEqual(stalePresented, 0, 'late frame callbacks after close cannot release an old cover');
  assert.strictEqual(typeof x.api.getPlaceholderSrc, 'undefined', 'transition guard no longer exposes a branded loading placeholder');

  assert.match(mainSource, /EgyBookVideoTransitionGuardV233/,'canonical player integrates the independent transition guard');
  assert.match(mainSource, /transitionGuard\?\.begin\?\.\(player,modal,requestedSource\)/,'each open starts a source-specific transition lease');
  assert.match(mainSource, /listenTransition\(player,'seeked',verifyHandoffSeek\)/,'handoff seek listeners are lease-managed');
  assert.match(mainSource, /EgyBookLivePreviewHandoffV234\?\.promote/,'direct feed opens promote the original decoded media element');
  assert.match(mainSource, /watchPresentedFrame\(transitionLease/,'live preview is retained until the current source presents its frame');
  assert.doesNotMatch(mainSource, /openingFrameCover|frameCanvas\.toDataURL|getPlaceholderSrc/,'video opening no longer creates a screenshot or branded placeholder');
  assert.match(mainSource, /cancel\?\.\(player,'player-close-request'\)/,'closing the player immediately cancels pending transition callbacks');
  assert.match(mainSource, /const restoredPost=activeEvpPost\?\.isConnected\?activeEvpPost:/,'Reels restoration resolves the retained post context');
  assert.match(mainSource, /if\(restoredPost\)\{syncEvpPostRail\(restoredPost\)/,'Reels author/actions rail is re-synchronized after session restore');

  const guardJs = 'egybook-video-transition-guard.js?v=234-transition-lease-no-placeholder';
  const handoffJs = 'egybook-live-preview-handoff.js?v=234-live-preview-handoff';
  const handoffCss = 'egybook-live-preview-handoff.css?v=234-live-preview-handoff';
  assert.ok(htmlSource.includes(guardJs) && htmlSource.includes(handoffJs) && htmlSource.includes(handoffCss), 'V234 handoff JavaScript and CSS modules are linked in HTML');
  assert.ok(htmlSource.indexOf(guardJs) < htmlSource.indexOf('script.js?v=248-adaptive-render-concurrency') && htmlSource.indexOf(handoffJs) < htmlSource.indexOf('script.js?v=248-adaptive-render-concurrency'), 'handoff modules load before the main script');
  assert.ok(swSource.includes(guardJs) && swSource.includes(handoffJs) && swSource.includes(handoffCss), 'V234 modules are included in Service Worker core assets');
  assert.ok(swSource.includes('2026-11-egybook-v248-device-intelligence-adaptive-performance'), 'Service Worker cache version is advanced to the current V245 diagnostic shell');

  console.log('V234 Video transition lease guard tests: PASS 26/26');
})().catch(error => { console.error(error); process.exitCode = 1; });
