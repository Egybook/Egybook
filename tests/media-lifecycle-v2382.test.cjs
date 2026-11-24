const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const lifecycleSource = fs.readFileSync(path.join(root, 'egybook-media-lifecycle.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const swipeSource = fs.readFileSync(path.join(root, 'swipe-navigation.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'egybook-background-resume.js'), 'utf8');
const renewalSource = fs.readFileSync(path.join(root, 'egybook-video-url-renewal.js'), 'utf8');
const recoverySource = fs.readFileSync(path.join(root, 'egybook-reels-return-recovery.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class Target {
  constructor() { this.listeners = Object.create(null); this.events = []; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  dispatchEvent(event) { this.events.push(event); (this.listeners[event.type] || []).slice().forEach(fn => fn(event)); return true; }
}
class MockCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; } }
function harness() {
  const window = new Target();
  const document = new Target();
  document.hidden = false;
  document.visibilityState = 'visible';
  document.body = { dataset: { egybookActivePage: 'home' } };
  document.getElementById = () => null;
  document.querySelectorAll = () => [];
  let rafId = 0;
  const rafs = new Map();
  window.requestAnimationFrame = fn => { const id = ++rafId; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => rafs.delete(id);
  const flush = () => { const work = Array.from(rafs.values()); rafs.clear(); work.forEach(fn => fn()); };
  vm.runInNewContext(lifecycleSource, { window, document, CustomEvent: MockCustomEvent, String, Object, Array, Set, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame });
  return { window, document, api: window.EgyBookMediaLifecycleV2382, flush };
}

{
  const h = harness();
  assert.strictEqual(h.api.version, '238.2', 'lifecycle coordinator is versioned');
  h.document.dispatchEvent(new MockCustomEvent('egybook:primarypagechange', { detail: { page: 'messages' } }));
  assert.ok(h.document.events.some(event => event.type === 'egybook:feed-media-suspend'), 'leaving a feed route suspends feed media');
  assert.ok(h.window.events.some(event => event.type === 'egybook:media-lifecycle-reels-suspend'), 'route change releases Reels preview resources');
  h.flush();
  assert.strictEqual(h.api.getSnapshot().page, 'messages', 'active route is tracked');
  assert.strictEqual(h.document.events.some(event => event.type === 'egybook:feed-media-resume'), false, 'non-feed route does not resume feed autoplay');
  h.document.dispatchEvent(new MockCustomEvent('egybook:primarypagechange', { detail: { page: 'home' } }));
  h.flush();
  assert.ok(h.document.events.some(event => event.type === 'egybook:feed-media-resume'), 'returning to Home resumes only the active feed owner');
  const resumeSignals = h.document.events.filter(event => event.type === 'egybook:feed-media-resume').length;
  h.window.dispatchEvent(new MockCustomEvent('pageshow'));
  assert.strictEqual(h.document.events.filter(event => event.type === 'egybook:feed-media-resume').length, resumeSignals, 'pageshow after an already-handled route resume does not duplicate media work');
}
{
  const h = harness();
  h.document.visibilityState = 'hidden'; h.document.hidden = true;
  h.document.dispatchEvent(new MockCustomEvent('visibilitychange'));
  assert.strictEqual(h.api.getSnapshot().suspended, true, 'background visibility suspends the lifecycle');
  h.document.visibilityState = 'visible'; h.document.hidden = false;
  h.document.dispatchEvent(new MockCustomEvent('visibilitychange'));
  assert.strictEqual(h.api.getSnapshot().suspended, false, 'foreground visibility resumes the lifecycle');
}

assert.match(mainSource, /function suspendFeedVideosForLifecycle/, 'main feed has an explicit suspension owner');
assert.match(mainSource, /discardPendingRestore\?\.\(video\)/, 'feed suspension cancels stale Hovod playhead restoration without disabling ticket renewal');
assert.match(mainSource, /discardPendingRestore\?\.\(player\)/, 'Reels route suspension cancels stale canonical playhead restoration');
assert.doesNotMatch(mainSource, /document\.addEventListener\('visibilitychange',[^\n]*activeFeedVideo/, 'legacy feed visibility listener cannot race the lifecycle coordinator');
assert.doesNotMatch(mainSource, /window\.addEventListener\('pagehide',[^\n]*activeFeedVideo/, 'legacy feed pagehide listener cannot erase active-video identity');
assert.match(mainSource, /video\.preload='none'/, 'inactive feed media stops speculative preload');
assert.match(mainSource, /let target=0/, 'Reels route return seeks to 0:00');
assert.match(mainSource, /player\.preload=saved\.preload\|\|'auto';[\s\S]*?let metadataTimeoutId=/, 'saved preload is restored before waiting for metadata');
assert.match(mainSource, /resumePolicy:'restart-from-start'/, 'route suspension carries restart policy');
assert.match(backgroundSource, /player\.pause\(\)/, 'app background pauses the canonical player');
assert.match(backgroundSource, /resetToStart\(player\)/, 'app background resets the canonical player to 0:00');
assert.match(backgroundSource, /discardPendingRestore\?\./, 'background restart cancels stale ticket-renewal playhead restore');
assert.match(renewalSource, /function discardPendingRestore\(video\)/, 'ticket renewal exposes narrow pending-restore cancellation');
assert.match(swipeSource, /function suspendPreviewResources\(\)/, 'Reels has a dedicated preview resource release path');
assert.match(swipeSource, /node\.removeAttribute\('src'\)/, 'detached warm previews release media sources');
assert.match(swipeSource, /transientVideo\.removeAttribute\('src'\)/, 'in-flight preview releases its own media source before detaching');
assert.match(mainSource, /const wasPlaying=!video\.paused&&!video\.ended;\s*const wasActive=video===activeFeedVideo;[\s\S]*?if\(\(wasPlaying\|\|wasActive\)&&Number\.isFinite\(video\.currentTime\)/, 'only active or playing feed media is reset, avoiding seeks across every off-screen card');
assert.match(mainSource, /if\(player\)player\.preload='none'/, 'hidden Reels player stops speculative loading while retaining its URL');
assert.match(recoverySource, /preferredPostId,/, 'return fallback prefers same Reel');
assert.ok(indexSource.includes('egybook-media-lifecycle.js?v=2382-smart-media-lifecycle'), 'new lifecycle module is loaded');
assert.ok(swSource.includes('egybook-media-lifecycle.js?v=2382-smart-media-lifecycle'), 'new lifecycle module is precached');
assert.ok(swSource.includes('2026-11-egybook-v241-handoff-audio-continuity'), 'Service Worker cache version advances');

console.log('V238.2 Smart Media Lifecycle: PASS lifecycle guards verified');
