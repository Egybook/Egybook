'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const coordinatorSource = fs.readFileSync(path.join(root, 'egybook-reels-playback-coordinator.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class FakeMedia {
  constructor({ volume = 1, muted = false, paused = false, src = '/media/test.mp4', currentSrc = src } = {}) {
    this.volume = volume;
    this.muted = muted;
    this.paused = paused;
    this.ended = false;
    this.src = src;
    this.currentSrc = currentSrc;
    this.attributes = new Map([['src', src]]);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}

async function makeCoordinator() {
  const identity = {
    sameResource(first, second) {
      const normalize = value => {
        try { return new URL(String(value), 'https://egybook.test/').href; }
        catch (_) { return String(value); }
      };
      return normalize(first) === normalize(second);
    }
  };
  const window = {
    EgyBookVideoResourceIdentityV237: identity,
    performance: { now: () => Date.now() },
    requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 1); },
    cancelAnimationFrame(id) { clearTimeout(id); }
  };
  const document = { hidden: false, baseURI: 'https://egybook.test/' };
  vm.runInNewContext(coordinatorSource, {
    window, document, Object, Array, Number, String, Math, Promise, Set, Date, URL,
    setTimeout, clearTimeout
  });
  return window.EgyBookReelsPlaybackCoordinatorV239;
}

(async () => {
  const api = await makeCoordinator();
  assert.equal(api.version, '243.0', 'the additive coordinator readiness guard is versioned');
  assert.equal(typeof api.isIncomingReady, 'function', 'the coordinator exposes the incoming-media readiness guard');

  const outgoing = new FakeMedia({ volume: 0.68, paused: false, src: '/media/outgoing.mp4' });
  const incoming = new FakeMedia({ volume: 1, paused: true, src: '/media/incoming.mp4', currentSrc: '/media/outgoing.mp4' });
  const session = await api.beginHandoff({ owner: outgoing, elements: [outgoing, incoming], fadeOutMs: 0, fadeInMs: 0 });
  assert.ok(session, 'the handoff lease is issued');
  assert.equal(api.prepareIncoming(session, incoming), true, 'incoming media is prepared under the lease');

  // The old resource may still have a queued `playing` event after a source
  // transition has begun. It must not qualify as the new incoming resource.
  incoming.paused = false;
  assert.equal(api.isIncomingReady(session, incoming, '/media/incoming.mp4'), false,
    'an old currentSrc cannot satisfy the incoming resource guard');

  incoming.currentSrc = '/media/incoming.mp4';
  incoming.paused = true;
  assert.equal(api.isIncomingReady(session, incoming, '/media/incoming.mp4'), false,
    'a paused incoming element cannot activate audio');

  incoming.paused = false;
  assert.equal(api.isIncomingReady(session, incoming, '/media/incoming.mp4'), true,
    'only the playing prepared incoming resource qualifies');
  assert.equal(await api.activateIncoming(session, incoming), true, 'qualified incoming playback activates audio');
  assert.equal(incoming.muted, false, 'the saved unmuted preference is restored');
  assert.ok(Math.abs(incoming.volume - 0.68) < 0.01, 'the outgoing user volume is restored');
  assert.equal(api.isIncomingReady(session, incoming, '/media/incoming.mp4'), false,
    'a completed lease cannot reactivate the same transition');

  const activationStart = mainSource.indexOf('const activateIncomingAudio=async(trigger)=>{');
  const activationEnd = mainSource.indexOf('\n    };', activationStart);
  assert.ok(activationStart >= 0 && activationEnd > activationStart, 'the application activation gate is present');
  const activationBlock = mainSource.slice(activationStart, activationEnd);
  assert.match(activationBlock, /incomingAudioActivationPending/, 'duplicate concurrent activation attempts are guarded');
  assert.match(activationBlock, /handoffPlayStarted&&audioHandoff\.isIncomingReady/, 'activation requires a real play request and matching incoming source');
  assert.match(activationBlock, /if\(!activated\|\|!isTransitionCurrent\(\)\)return false;[\s\S]*?incomingAudioActivated=true;/,
    'the activation latch is set only after successful activation');
  const playingListenerStart = mainSource.indexOf("removeIncomingPlayingWaiter=listenTransition(player,'playing',");
  const playingListenerEnd = mainSource.indexOf('});', playingListenerStart);
  assert.ok(playingListenerStart >= 0 && playingListenerEnd > playingListenerStart, 'the persistent playing listener is present');
  const playingListenerBlock = mainSource.slice(playingListenerStart, playingListenerEnd + 3);
  assert.match(playingListenerBlock, /activateIncomingAudio\('playing-event'\)/, 'the playing listener retries activation at the media boundary');
  assert.doesNotMatch(playingListenerBlock, /once\s*:\s*true/, 'the listener is not consumed by a stale event');
  assert.ok(htmlSource.includes('egybook-reels-playback-coordinator.js?v=243-incoming-audio-resource-guard'), 'HTML loads the guarded coordinator');
  assert.ok(htmlSource.includes('script.js?v=248-adaptive-render-concurrency'), 'HTML loads the guarded main script');
  assert.ok(swSource.includes("const VERSION = '2026-11-egybook-v248-device-intelligence-adaptive-performance';"), 'Service Worker cache is advanced');
  assert.ok(swSource.includes('script.js?v=248-adaptive-render-concurrency'), 'Service Worker precaches the guarded main script');

  console.log('EgyBook V243 Reels Audio Activation Guard: PASS 19 assertions');
})().catch(error => { console.error(error); process.exitCode = 1; });
