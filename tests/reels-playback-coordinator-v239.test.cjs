const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-reels-playback-coordinator.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const swipeSource = fs.readFileSync(path.join(root, 'swipe-navigation.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class FakeMedia {
  constructor({ volume = 1, muted = false, paused = false, src = '/media/test.mp4' } = {}) {
    this.volume = volume;
    this.muted = muted;
    this.paused = paused;
    this.ended = false;
    this.currentSrc = src;
    this.src = src;
    this.attributes = new Map([['src', src]]);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}

function setup() {
  const window = {
    performance: { now: () => Date.now() },
    requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 2); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
  const document = { hidden: false };
  vm.runInNewContext(moduleSource, { window, document, Object, Array, Number, String, Math, Promise, Set, Date, setTimeout, clearTimeout });
  return window.EgyBookReelsPlaybackCoordinatorV239;
}

(async () => {
  const api = setup();
  assert.strictEqual(api.version, '243.0', 'coordinator keeps the stable API name and advances its implementation version');

  // 1. Sequential handoff: outgoing audio reaches zero before incoming starts,
  // then the canonical incoming element ramps to the user's previous level.
  {
    const oldVideo = new FakeMedia({ volume: 0.82, muted: false, paused: false, src: '/media/old.mp4' });
    const nextVideo = new FakeMedia({ volume: 1, muted: false, paused: true, src: '/media/next.mp4' });
    const session = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo, nextVideo], fadeOutMs: 24, fadeInMs: 28 });
    assert.ok(session, 'handoff session is issued');
    assert.ok(oldVideo.volume <= 0.01, 'outgoing audible owner is faded to silence before source switch');
    assert.strictEqual(api.getSettings(session).muted, false, 'unmuted state is retained');
    assert.ok(Math.abs(api.getSettings(session).volume - 0.82) < 0.01, 'user volume is retained independently of fade-out');
    assert.strictEqual(api.prepareIncoming(session, nextVideo), true, 'canonical incoming element is prepared');
    assert.ok(nextVideo.volume <= 0.01, 'incoming unmuted source stays silent until playback starts');
    nextVideo.paused = false;
    assert.strictEqual(await api.activateIncoming(session, nextVideo), true, 'incoming audio activates after playback starts');
    assert.ok(Math.abs(nextVideo.volume - 0.82) < 0.04, 'incoming element returns smoothly to saved volume');
  }

  // 2. V241 accepts an explicit zero-length incoming ramp so the incoming
  // source becomes audible at the playing boundary without adding a second gap.
  {
    const oldVideo = new FakeMedia({ volume: 0.73, muted: false, paused: false, src: '/media/instant-old.mp4' });
    const nextVideo = new FakeMedia({ volume: 1, muted: false, paused: true, src: '/media/instant-next.mp4' });
    const session = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 12, fadeInMs: 0 });
    assert.ok(session, 'zero-fade handoff session is issued');
    assert.strictEqual(api.prepareIncoming(session, nextVideo), true, 'incoming media is prepared before playback');
    assert.ok(nextVideo.volume <= 0.01, 'incoming media remains silent before playback starts');
    nextVideo.paused = false;
    assert.strictEqual(await api.activateIncoming(session, nextVideo), true, 'zero-fade incoming activation completes synchronously after playback starts');
    assert.ok(Math.abs(nextVideo.volume - 0.73) < 0.01, 'saved user volume is restored without a post-start ramp');
    assert.strictEqual(nextVideo.muted, false, 'saved unmuted preference is applied at activation');
  }

  // 3. The coordinator releases its completed lease so later user volume
  // changes become the next transition's real preference, not a stale target.
  {
    const oldVideo = new FakeMedia({ volume: 0.8, muted: false, paused: false, src: '/media/level-old.mp4' });
    const nextVideo = new FakeMedia({ volume: 1, muted: false, paused: true, src: '/media/level-next.mp4' });
    const first = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 12, fadeInMs: 12 });
    api.prepareIncoming(first, nextVideo);
    nextVideo.paused = false;
    assert.strictEqual(await api.activateIncoming(first, nextVideo), true, 'first handoff completes');
    nextVideo.volume = 0.37; // User changes the slider after playback starts.
    const following = await api.beginHandoff({ owner: nextVideo, elements: [nextVideo], fadeOutMs: 12 });
    assert.ok(following, 'subsequent swipe receives a fresh session');
    assert.ok(Math.abs(api.getSettings(following).volume - 0.37) < 0.01, 'next swipe captures the latest user-selected volume');
    api.cancel(following, { restoreOutgoing: true });
  }

  // 4. Muted state remains muted while the volume preference is retained.
  {
    const oldVideo = new FakeMedia({ volume: 0.64, muted: true, paused: false, src: '/media/muted-old.mp4' });
    const nextVideo = new FakeMedia({ volume: 1, muted: false, paused: true, src: '/media/muted-next.mp4' });
    const session = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 12 });
    assert.strictEqual(session.muted, true, 'mute preference is captured from the current owner');
    assert.strictEqual(api.prepareIncoming(session, nextVideo), true, 'muted incoming media is prepared');
    assert.strictEqual(nextVideo.muted, true, 'incoming media stays muted');
    assert.ok(Math.abs(nextVideo.volume - 0.64) < 0.01, 'volume slider setting is preserved while muted');
    nextVideo.paused = false;
    assert.strictEqual(await api.activateIncoming(session, nextVideo), true, 'muted playback can become active without unmuting');
    assert.strictEqual(nextVideo.muted, true, 'activation does not override mute');
  }

  // 5. Muted previews and paused companions are not treated as audible owners.
  {
    const audible = new FakeMedia({ volume: 0.7, muted: false, paused: false, src: '/media/audible.mp4' });
    const silentPreview = new FakeMedia({ volume: 1, muted: true, paused: false, src: '/media/preview.mp4' });
    const pausedAudio = new FakeMedia({ volume: 0.9, muted: false, paused: true, src: '/media/paused-audio.mp3' });
    const session = await api.beginHandoff({ owner: audible, elements: [audible, silentPreview, pausedAudio], fadeOutMs: 18 });
    assert.ok(audible.volume <= 0.01, 'audible owner is silenced');
    assert.strictEqual(silentPreview.volume, 1, 'already-muted preview is not modified');
    assert.strictEqual(pausedAudio.volume, 0.9, 'paused companion is not modified');
    api.cancel(session);
  }

  // 6. If a transition is abandoned before the source switch, the outgoing
  // element can be restored to its original volume and mute state.
  {
    const oldVideo = new FakeMedia({ volume: 0.58, muted: false, paused: false, src: '/media/restore.mp4' });
    const session = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 16 });
    assert.ok(oldVideo.volume <= 0.01, 'outgoing fade completed before cancellation');
    assert.strictEqual(api.cancel(session, { restoreOutgoing: true }), true, 'current handoff can be cancelled');
    assert.ok(Math.abs(oldVideo.volume - 0.58) < 0.01, 'aborted transition restores original volume');
    assert.strictEqual(oldVideo.muted, false, 'aborted transition restores mute state');
    assert.strictEqual(api.isCurrent(session), false, 'cancelled session cannot affect later playback');
  }

  // 7. A superseded handoff cannot continue fading or claim the next source.
  {
    const oldVideo = new FakeMedia({ volume: 0.76, muted: false, paused: false, src: '/media/superseded.mp4' });
    const firstPromise = api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 90 });
    await new Promise(resolve => setTimeout(resolve, 12));
    assert.ok(oldVideo.volume < 0.76, 'first handoff has begun fading before it is superseded');
    const secondPromise = api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 16 });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.strictEqual(first, null, 'superseded session is rejected');
    assert.ok(second, 'newest session remains active');
    assert.ok(Math.abs(api.getSettings(second).volume - 0.76) < 0.01, "superseding a partial fade does not lower the user's saved volume");
    assert.strictEqual(api.isCurrent(second), true, 'only newest token owns the handoff');
    api.cancel(second, { restoreOutgoing: true });
  }

  // 8. Platforms with a read-only media volume (notably some iOS paths) use
  // a temporary mute gate so no incoming sound leaks before play() resolves.
  {
    const oldVideo = new FakeMedia({ volume: 1, muted: false, paused: false, src: '/media/readonly-old.mp4' });
    Object.defineProperty(oldVideo, 'volume', { configurable: true, get: () => 1, set: () => {} });
    const nextVideo = new FakeMedia({ volume: 1, muted: false, paused: true, src: '/media/readonly-next.mp4' });
    Object.defineProperty(nextVideo, 'volume', { configurable: true, get: () => 1, set: () => {} });
    const session = await api.beginHandoff({ owner: oldVideo, elements: [oldVideo], fadeOutMs: 16 });
    assert.strictEqual(oldVideo.muted, true, 'read-only outgoing media is muted as a safe fallback');
    assert.strictEqual(api.prepareIncoming(session, nextVideo), true, 'read-only incoming media is prepared');
    assert.strictEqual(nextVideo.muted, true, 'incoming source remains muted until playback is ready');
    nextVideo.paused = false;
    assert.strictEqual(await api.activateIncoming(session, nextVideo), true, 'mute gate releases only after playback starts');
    assert.strictEqual(nextVideo.muted, false, 'saved unmuted preference is restored after readiness');
  }

  // 9. Integration guards: no new player is created; existing preview stays
  // muted; only the Reels queue path coordinates handoff; all assets are wired.
  assert.match(mainSource, /activeEvpQueueContext==='reels'[\s\S]*?beginHandoff/, 'handoff is scoped to the Reels queue');
  assert.match(mainSource, /owner:getEvpSoundMedia\(\)/, 'current audible owner supplies mute/volume state');
  assert.match(mainSource, /prepareIncoming\?\.\(audioHandoffSession,player\)/, 'canonical video player receives the handoff');
  assert.match(mainSource, /activateIncoming\?\.\(audioHandoffSession,player\)/, 'canonical video audio activates after play resolves');
  assert.match(mainSource, /activateIncoming\?\.\(audioHandoffSession,audio\)/, 'legacy music-track audio uses the same coordinator');
  assert.match(mainSource, /activateIncoming\?\.\(audioHandoffSession,sourceAudio\)/, 'legacy original-source audio uses the same coordinator');
  assert.match(mainSource, /if\(!audioHandoffSession\|\|!audioHandoffSettings\?\.muted\)/, 'rejected autoplay preserves the existing Reels mute preference');
  assert.match(mainSource, /keepReelsContext=replace&&activeEvpQueueContext==='reels'/, 'music-backed Reels items retain their Reels queue context');
  assert.match(swipeSource, /media\.muted=true;media\.defaultMuted=true/, 'incoming swipe preview remains silent');
  assert.doesNotMatch(moduleSource, /createElement\s*\(/, 'coordinator creates no additional media elements');
  const executableCoordinator = moduleSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(executableCoordinator, /AudioContext|fetch\s*\(|supabase|indexedDB|localStorage/, 'coordinator adds no audio graph, network, storage or database work');
  assert.ok(htmlSource.includes('egybook-reels-playback-coordinator.js?v=243-incoming-audio-resource-guard'), 'coordinator is wired before the main script');
  assert.ok(htmlSource.includes('script.js?v=244-modular-core'), 'main script cache key is advanced');
  assert.ok(swSource.includes('egybook-reels-playback-coordinator.js?v=243-incoming-audio-resource-guard'), 'coordinator is in the Service Worker core shell');
  assert.ok(swSource.includes("2026-11-egybook-v246-adaptive-device-load-guard"), 'Service Worker cache is versioned for V241');

  assert.match(mainSource, /listenTransition\(player,'playing'[\s\S]*?activateIncomingAudio\('playing-event'\)/, 'incoming audio activates at the media playing boundary');
  assert.match(mainSource, /fadeInMs:0/, 'Reels handoff does not introduce an extra incoming fade delay');
  console.log('EgyBook Unified Reels Playback Coordinator V241: PASS 59 assertions');
})().catch(error => { console.error(error); process.exitCode = 1; });
