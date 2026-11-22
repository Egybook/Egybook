const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'egybook-background-resume.js'), 'utf8');

class Target {
  constructor() { this.listeners = {}; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
}
function setup() {
  const window = new Target();
  const document = new Target();
  document.visibilityState = 'visible';
  const bodyClasses = new Set(['egybook-reels-active']);
  document.body = { dataset: { egybookActivePage: 'reels' }, classList: { contains: x => bodyClasses.has(x), add: x => bodyClasses.add(x), remove: x => bodyClasses.delete(x) } };
  const modalClasses = new Set(['evp-reels-context']);
  const modal = { dataset: { postId: 'reel-7' }, classList: { contains: x => modalClasses.has(x) } };
  const makeMedia = (src) => ({
    currentSrc: src, src, paused: false, ended: false, currentTime: 42, duration: 180,
    readyState: 4, muted: false, volume: 0.8, playbackRate: 1.5, seeking: false,
    listeners: {}, getAttribute(k) { return k === 'src' ? this.src : null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
    play() { this.paused = false; this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); }
  });
  const player = makeMedia('https://media.example/reel.mp4');
  const audio = makeMedia('https://media.example/audio.mp3');
  const sourceAudio = makeMedia('');
  const map = { egybookVideoModal: modal, egybookVideoPlayer: player, egybookVideoAudio: audio, egybookVideoSourceAudio: sourceAudio };
  document.getElementById = id => map[id] || null;
  const context = { window, document, Date, Number, String, Math, setTimeout, clearTimeout, Object };
  vm.runInNewContext(source, context);
  return { window, document, bodyClasses, modal, modalClasses, player, audio, api: window.__egybookBackgroundResumeV230 };
}

{
  const x = setup();
  x.document.visibilityState = 'hidden';
  x.document.dispatch('visibilitychange');
  assert.strictEqual(x.api.hasSnapshot(), true, 'hidden state captured');
  x.player.currentTime = 4; x.player.paused = true; x.player.muted = true; x.player.playbackRate = 1;
  x.audio.currentTime = 3; x.audio.paused = true;
  x.document.visibilityState = 'visible';
  x.document.dispatch('visibilitychange');
  assert.strictEqual(x.player.currentTime, 42, 'video playhead restored');
  assert.strictEqual(x.player.muted, false, 'video mute state restored');
  assert.strictEqual(x.player.playbackRate, 1.5, 'video rate restored');
  assert.strictEqual(x.player.paused, false, 'video playback resumed');
  assert.strictEqual(x.audio.currentTime, 42, 'audio playhead restored');
  assert.strictEqual(x.audio.paused, false, 'audio playback resumed');
  assert.strictEqual(x.api.hasSnapshot(), false, 'snapshot consumed once');
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
  x.modal.dataset.evpSuspendedForRoute = 'true';
  x.document.visibilityState = 'hidden'; x.document.dispatch('visibilitychange');
  assert.strictEqual(x.api.hasSnapshot(), false, 'leaves route-suspended state to navigation owner');
}
console.log('V230 background/resume tests: PASS 4/4');
