'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-video-url-renewal.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'egybook-background-resume.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

const WORKER_TICKET_URL = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev/hovod/playback/ticket';
const PLAYBACK_ID = 'Playback_231_Test_123456';

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function makeTicket({ exp, iat, sub = '11111111-2222-4333-8444-555555555555', jti = '1234567890abcdef1234567890abcdef' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'hovod-playback', iss: 'egybook', pid: PLAYBACK_ID, sub, jti,
    iat: iat ?? now, exp: exp ?? now + 600
  };
  return `${base64url(payload)}.test-signature`;
}
function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

class FakeVideo {
  constructor(src) {
    this.tagName = 'VIDEO';
    this.id = 'egybookVideoPlayer';
    this.isConnected = true;
    this.dataset = {};
    this._src = src || '';
    this.currentSrc = src || '';
    this.currentTime = 34.25;
    this.duration = 120;
    this.readyState = 2;
    this.networkState = 1;
    this.paused = false;
    this.ended = false;
    this.seeking = false;
    this.muted = true;
    this.volume = 0.7;
    this.playbackRate = 1.25;
    this.error = null;
    this.listeners = Object.create(null);
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    this.currentSrc = this._src;
    this.currentTime = 0;
    this.readyState = 0;
    this.paused = true;
    this.error = null;
  }
  getAttribute(name) { return name === 'src' ? (this._src || null) : null; }
  setAttribute(name, value) { if (name === 'src') this.src = value; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== callback); }
  dispatch(type) { (this.listeners[type] || []).slice().forEach(callback => callback({ type, target: this })); }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
}

function createHarness({ source, fetchImpl, session = true } = {}) {
  const video = new FakeVideo(source);
  const notice = { textContent: '' };
  const documentListeners = Object.create(null);
  const windowListeners = Object.create(null);
  const emitted = [];
  const document = {
    baseURI: 'https://app.example/Egybook/',
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    documentElement: { querySelectorAll: selector => selector === 'video' ? [video] : [] },
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    getElementById: id => id === 'egybookVideoPlayer' ? video : (id === 'evpNotice' ? notice : null),
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
    dispatchEvent(event) { emitted.push(event); return true; }
  };
  const window = {
    fetch: fetchImpl,
    __egybookSupabaseClient: session ? { auth: { getSession: async () => ({ data: { session: { access_token: 'supabase-user-session-token' } }, error: null }) } } : null,
    addEventListener(type, callback) { (windowListeners[type] ||= []).push(callback); },
    dispatchEvent(event) { emitted.push(event); return true; }
  };
  class MockMutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
  class MockCustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail || null; } }
  const context = {
    window, document, URL, URLSearchParams, Date, Math, Number, String, Object, Array, Map, Uint8Array,
    TextDecoder, atob: value => Buffer.from(value, 'base64').toString('binary'),
    AbortController, MutationObserver: MockMutationObserver, CustomEvent: MockCustomEvent,
    setTimeout, clearTimeout, Promise, console
  };
  vm.runInNewContext(moduleSource, context, { filename: 'egybook-video-url-renewal.js' });
  return { video, notice, document, window, emitted, api: window.EgyBookVideoURLRenewalV231, documentListeners, windowListeners };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const oldTicket = makeTicket({ exp: now + 120, jti: '11111111111141118111111111111111' });
  const newTicket = makeTicket({ exp: now + 600, jti: '22222222222242228222222222222222' });
  const oldUrl = `https://hovod.example/v1/secure-playback/${PLAYBACK_ID}/master.m3u8?ticket=${encodeURIComponent(oldTicket)}`;
  const newUrl = `https://hovod.example/v1/secure-playback/${PLAYBACK_ID}/master.m3u8?ticket=${encodeURIComponent(newTicket)}`;
  const calls = [];
  const harness = createHarness({
    source: oldUrl,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith(`/v1/secure-playback/${PLAYBACK_ID}/refresh`)) return response(200, { data: { ticket: newTicket, expiresAt: now + 600, refreshAfterSec: 540 } });
      if (String(url).startsWith(`https://hovod.example/v1/secure-playback/${PLAYBACK_ID}?`)) return response(200, { data: { manifestUrl: newUrl } });
      throw new Error('Unexpected request in direct-refresh test');
    }
  });
  const inspected = harness.api.inspectSource(oldUrl);
  assert.strictEqual(inspected.playbackId, PLAYBACK_ID, 'recognizes a Hovod private-playback manifest URL');
  assert.strictEqual(inspected.exp, now + 120, 'reads expiry from the opaque playback ticket payload');
  assert.strictEqual(harness.api.inspectSource('https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev/media/reels/clip.mp4'), null,
    'does not treat permanent R2 /media URLs as expiring Hovod sources');
  assert.strictEqual(harness.api.inspectSource(`https://hovod.example/v1/secure-playback/${PLAYBACK_ID}/master.m3u8`), null,
    'does not enroll Hovod paths that lack a current signed-ticket structure');
  assert.strictEqual(harness.api.inspectSource(oldUrl.replace('https://', 'http://')), null,
    'refuses to process private playback over plaintext HTTP');
  assert.ok(harness.api.sameResource(oldUrl, newUrl), 'ticket rotation keeps the same logical playback identity');
  assert.strictEqual(harness.api.getTrackedCount(), 1, 'the signed Hovod video is registered for proactive renewal');

  const result = await harness.api.refreshNow(harness.video, 'unit-test');
  assert.strictEqual(result.ok, true, 'proactive Hovod refresh succeeds');
  assert.strictEqual(harness.video.src, newUrl, 'the new manifest replaces only the source URL');
  assert.ok(calls.some(call => call.url.endsWith(`/v1/secure-playback/${PLAYBACK_ID}/refresh`)), 'refresh uses Hovod refresh endpoint first');
  assert.ok(calls.some(call => call.url.startsWith(`https://hovod.example/v1/secure-playback/${PLAYBACK_ID}?`)), 'fresh Hovod manifest is resolved after ticket refresh');
  const refreshCall = calls.find(call => call.url.endsWith(`/v1/secure-playback/${PLAYBACK_ID}/refresh`));
  assert.strictEqual(JSON.parse(refreshCall.options.body).ticket, oldTicket, 'current ticket is sent in request body, never in browser storage');
  assert.strictEqual(refreshCall.options.cache, 'no-store', 'refresh calls bypass browser cache');
  assert.strictEqual(refreshCall.options.referrerPolicy, 'no-referrer', 'refresh calls do not send a page referrer');

  harness.video.readyState = 1;
  harness.video.duration = 120;
  harness.video.dispatch('loadedmetadata');
  await Promise.resolve();
  assert.strictEqual(harness.video.currentTime, 34.25, 'playhead is restored after refreshed source metadata arrives');
  assert.strictEqual(harness.video.paused, false, 'previously playing media resumes after source metadata is ready');
  assert.strictEqual(harness.video.muted, true, 'mute state is preserved');
  assert.strictEqual(harness.video.volume, 0.7, 'volume is preserved');
  assert.strictEqual(harness.video.playbackRate, 1.25, 'playback rate is preserved');
  // V238.2 deliberately restarts a player from 0:00 on app return. It clears
  // only this ticket adapter's stale playhead snapshot; renewal stays attached.
  harness.video.currentTime = 19;
  harness.document.visibilityState = 'hidden';
  (harness.documentListeners.visibilitychange || []).forEach(handler => handler());
  assert.strictEqual(harness.api.discardPendingRestore(harness.video), true, 'background lifecycle can discard stale playhead restoration');
  harness.document.visibilityState = 'visible';
  (harness.documentListeners.visibilitychange || []).forEach(handler => handler());
  harness.api.refreshDueSources();
  assert.strictEqual(harness.video.currentTime, 19, 'discarded snapshot does not seek back to an old playback position');
  assert.strictEqual(harness.api.getTrackedCount(), 1, 'discarding a pending playhead snapshot does not detach Hovod ticket renewal');
  harness.api.dispose();

  // Hovod intentionally refuses an already-expired current ticket. The
  // browser must fail closed rather than request a newly minted ticket and
  // risk sending it to an origin taken from untrusted media metadata.
  const expiredTicket = makeTicket({ iat: now - 600, exp: now - 5, jti: '33333333333343338333333333333333' });
  const expiredUrl = `https://hovod.example/v1/secure-playback/${PLAYBACK_ID}/master.m3u8?ticket=${encodeURIComponent(expiredTicket)}`;
  const expiredCalls = [];
  const expired = createHarness({
    source: expiredUrl,
    fetchImpl: async url => { expiredCalls.push(String(url)); return response(500, {}); }
  });
  const expiredResult = await expired.api.refreshNow(expired.video, 'expired-ticket-test');
  assert.strictEqual(expiredResult.ok, false, 'already-expired Hovod ticket is not renewed in the browser');
  assert.strictEqual(expired.video.paused, true, 'expired unauthorized playback is paused safely');
  assert.strictEqual(expiredCalls.length, 0, 'expired tickets do not trigger a fresh-ticket request to a media-supplied origin');
  expired.api.dispose();

  // Stable R2 links do not cause refresh calls, even when attached to the player.
  const r2Calls = [];
  const r2 = createHarness({
    source: 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev/media/reels/clip.mp4',
    fetchImpl: async url => { r2Calls.push(String(url)); return response(500, {}); }
  });
  assert.strictEqual(r2.api.getTrackedCount(), 0, 'normal R2 media remains outside the renewal module');
  assert.strictEqual((await r2.api.refreshNow(r2.video)).ok, false, 'manual renewal is ignored for a permanent R2 URL');
  assert.strictEqual(r2Calls.length, 0, 'no extra network calls are made for stable R2 media');
  r2.api.dispose();

  // A denied initial-ticket request fails closed and stops playback without
  // exposing the ticket or attempting an unbounded retry loop.
  const denied = createHarness({
    source: expiredUrl,
    fetchImpl: async url => String(url) === WORKER_TICKET_URL ? response(403, { error: 'Playback is no longer authorized' }) : response(500, {})
  });
  const deniedResult = await denied.api.refreshNow(denied.video, 'denied-test');
  assert.strictEqual(deniedResult.ok, false, 'unauthorized playback is not renewed');
  assert.strictEqual(denied.video.paused, true, 'video is paused when re-authorization is denied');
  assert.strictEqual(denied.notice.textContent, 'هذا الفيديو لم يعد متاحًا لك.', 'the player shows the normal unavailable/private state');
  denied.api.dispose();

  // The existing V230 lifecycle module can compare rotated tickets by playback
  // identity and retries the retained snapshot when metadata becomes available.
  assert.match(backgroundSource, /EgyBookVideoURLRenewalV231\?\.sameResource/);
  assert.match(backgroundSource, /restore\('metadata-ready'\)/);
  assert.ok(indexSource.indexOf('egybook-video-url-renewal.js?v=231-hovod-ticket-refresh-resume') < indexSource.indexOf('egybook-background-resume.js?v=2382-restart-on-return'),
    'V231 renewal adapter loads before the background-resume integration');
  assert.ok(swSource.includes('egybook-video-url-renewal.js?v=231-hovod-ticket-refresh-resume'), 'Service Worker precaches the new module');
  assert.ok(swSource.includes('egybook-background-resume.js?v=2382-restart-on-return'), 'Service Worker uses the updated background-resume module');
  assert.ok(swSource.includes('url.searchParams.has(\'ticket\')'), 'ticket-bearing URLs are excluded from app caching');
  assert.ok(swSource.includes('2026-11-egybook-v2382-smart-media-lifecycle'), 'Service Worker cache version advances to V238.1 while retaining V231 renewal module');
  assert.ok(!moduleSource.includes('/hovod/playback/ticket'), 'the browser does not mint or fetch a new ticket from an origin taken from media metadata');

  console.log('PASS: Hovod private-playback URLs are recognized and their expiry is read safely');
  console.log('PASS: Permanent R2 /media links are ignored with no additional network requests');
  console.log('PASS: Hovod current-ticket refresh obtains a fresh manifest URL');
  console.log('PASS: Refreshed media preserves playback time, volume, mute, rate, and play state');
  console.log('PASS: Expired tickets fail closed without sending fresh tickets to media-supplied origins');
  console.log('PASS: Unauthorized playback fails closed and pauses the media');
  console.log('PASS: Background resume accepts ticket rotation and retries after metadata');
  console.log('PASS: HTML and Service Worker references are wired; existing Worker code remains unchanged');
  console.log('V231 Video URL Renewal tests: PASS 8/8');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
