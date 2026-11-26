const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'egybook-background-resume.js'), 'utf8');

class MockCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail || {}; } }
class Target {
  constructor() { this.listeners = {}; this.events = []; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
  dispatchEvent(event) { this.events.push(event); for (const fn of this.listeners[event.type] || []) fn(event); return true; }
}
function setup() {
  const window = new Target();
  const document = new Target();
  document.visibilityState = 'visible';
  const bodyClasses = new Set(['egybook-reels-active']);
  document.body = { dataset: { egybookActivePage: 'reels' }, classList: { contains: x => bodyClasses.has(x), add: x => bodyClasses.add(x), remove: x => bodyClasses.delete(x) } };
  const modalClasses = new Set(['evp-reels-context', 'open']);
  const modal = { dataset: { postId: 'reel-7' }, classList: { contains: x => modalClasses.has(x) } };
  const makeMedia = (src) => ({
    currentSrc: src, src, paused: false, ended: false, currentTime: 42, duration: 180,
    readyState: 4, muted: false, volume: 0.8, playbackRate: 1.5, seeking: false,
    listeners: {}, getAttribute(k) { return k === 'src' ? this.src : null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
    pause() { this.paused = true; this.pauseCalls = (this.pauseCalls || 0) + 1; },
    play() { this.paused = false; this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); }
  });
  const player = makeMedia('https://media.example/reel.mp4');
  const audio = makeMedia('https://media.example/audio.mp3');
  const sourceAudio = makeMedia('');
  const map = { egybookVideoModal: modal, egybookVideoPlayer: player, egybookVideoAudio: audio, egybookVideoSourceAudio: sourceAudio };
  document.getElementById = id => map[id] || null;
  const context = { window, document, CustomEvent: MockCustomEvent, Date, Number, String, Math, setTimeout, clearTimeout, Object }; 
  window.EgyBookVideoURLRenewalV231 = { discardPendingRestore(video) { video.discardedPendingRestore = true; return true; }, sameResource(a,b) { return a === b; } };
  vm.runInNewContext(source, context);
  return { window, document, bodyClasses, modal, modalClasses, player, audio, api: window.__egybookBackgroundResumeV2382 };
}

{
  const x = setup();
  x.document.visibilityState = 'hidden';
  x.document.dispatch('visibilitychange');
  assert.strictEqual(x.api.hasSnapshot(), true, 'hidden state captured');
  assert.strictEqual(x.player.paused, true, 'canonical video is paused immediately in background');
  assert.strictEqual(x.player.currentTime, 0, 'video playhead is reset to 0:00 while suspended');
  assert.strictEqual(x.audio.paused, true, 'associated audio is paused immediately');
  assert.strictEqual(x.audio.currentTime, 0, 'associated audio is reset to 0:00');
  assert.strictEqual(x.player.discardedPendingRestore, true, 'old Hovod playhead snapshot is discarded without disabling ticket renewal');
  x.window.dispatch('pagehide');
  assert.strictEqual(x.api.getSnapshot().wasPlaying, true, 'pagehide does not overwrite the original playing state after visibilitychange paused the element');
  x.document.visibilityState = 'visible';
  x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.currentTime, 0, 'video restarts from 0:00');
  assert.strictEqual(x.player.muted, false, 'video mute state restored');
  assert.strictEqual(x.player.playbackRate, 1.5, 'video rate restored');
  assert.strictEqual(x.player.paused, false, 'video playback resumed');
  assert.strictEqual(x.audio.currentTime, 0, 'audio restarts from 0:00');
  assert.strictEqual(x.audio.paused, false, 'audio playback resumed');
  assert.strictEqual(x.api.hasSnapshot(), false, 'snapshot consumed once');
  assert.strictEqual(x.api.version, '238.2', 'lifecycle policy is versioned');
}
{
  const x = setup();
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  x.bodyClasses.delete('egybook-reels-active');
  x.document.body.dataset.egybookActivePage = 'messages';
  x.player.paused = true; x.player.currentTime = 7;
  x.document.visibilityState = 'visible'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.currentTime, 7, 'does not restore over another route');
  assert.strictEqual(x.player.paused, true, 'does not resume outside Reels');
}
{
  const x = setup();
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  x.player.currentSrc = 'https://media.example/other.mp4';
  x.player.paused = true; x.player.currentTime = 2;
  x.document.visibilityState = 'visible'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.currentTime, 2, 'does not apply snapshot to a different source');
  assert.strictEqual(x.player.paused, true, 'does not resume a different source');
}
{
  const x = setup();
  x.player.paused = true;
  x.player.currentTime = 31;
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  x.document.visibilityState = 'visible'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.paused, true, 'a player that was paused before backgrounding remains paused on return');
  assert.strictEqual(x.player.currentTime, 0, 'a previously paused player still returns at 0:00');
}
{
  const x = setup();
  x.window.EgyBookVideoURLRenewalV231.sameResource = (a,b) => String(a).split('?')[0] === String(b).split('?')[0];
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  x.player.currentSrc = 'https://media.example/reel.mp4?ticket=renewed';
  x.window.dispatch('pagehide');
  x.document.visibilityState = 'visible'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.currentTime, 0, 'Hovod ticket rotation preserves the logical source and still restarts at zero');
  assert.strictEqual(x.player.paused, false, 'ticket rotation does not prevent the same authorized video from resuming');
}
{
  const x = setup();
  x.modal.dataset.evpSuspendedForRoute = 'true';
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.api.hasSnapshot(), false, 'leaves route-suspended state to navigation owner');
}
console.log('V230 background/resume tests: PASS 6/6');
