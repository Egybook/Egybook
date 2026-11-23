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
  assert.strictEqual(x.api.version, '233.0', 'transition guard has a dedicated version');
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
  assert.ok(x.api.getPlaceholderSrc().startsWith('data:image/svg+xml;charset=utf-8,'), 'branded non-black fallback is available without a remote poster');

  assert.match(mainSource, /EgyBookVideoTransitionGuardV233/,'canonical player integrates the independent transition guard');
  assert.match(mainSource, /transitionGuard\?\.begin\?\.\(player,modal,requestedSource\)/,'each open starts a source-specific transition lease');
  assert.match(mainSource, /listenTransition\(player,'seeked',verifyHandoffSeek\)/,'handoff seek listeners are lease-managed');
  assert.match(mainSource, /const needsLocalCover=!replace\|\|\(!transitionCover\?\.isConnected&&!resumeState\?\.fallbackCover\)/,'replacement without a swipe cover captures its own local frame');
  assert.match(mainSource, /transitionGuard\?\.getPlaceholderSrc\?\.\(\)/,'missing local poster falls back to a branded frame');
  assert.match(mainSource, /watchPresentedFrame\(transitionLease/,'opening cover waits for a frame from the current source');
  assert.match(mainSource, /cancel\?\.\(player,'player-close-request'\)/,'closing the player immediately cancels pending transition callbacks');
  assert.match(mainSource, /const restoredPost=activeEvpPost\?\.isConnected\?activeEvpPost:/,'Reels restoration resolves the retained post context');
  assert.match(mainSource, /if\(restoredPost\)\{syncEvpPostRail\(restoredPost\)/,'Reels author/actions rail is re-synchronized after session restore');

  const guardJs = 'egybook-video-transition-guard.js?v=233-transition-lease';
  const guardCss = 'egybook-video-transition-guard.css?v=233-transition-lease';
  assert.ok(htmlSource.includes(guardJs) && htmlSource.includes(guardCss), 'new JavaScript and CSS modules are linked in HTML');
  assert.ok(htmlSource.indexOf(guardJs) < htmlSource.indexOf('script.js?v=233-video-transition-reels-ui'), 'transition guard loads before the main script');
  assert.ok(swSource.includes(guardJs) && swSource.includes(guardCss), 'new modules are included in Service Worker core assets');
  assert.ok(swSource.includes('2026-11-egybook-v233-video-transition-reels-ui'), 'Service Worker cache version is advanced to V233');

  console.log('V233 Video transition guard tests: PASS 26/26');
})().catch(error => { console.error(error); process.exitCode = 1; });
