const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const recoverySource = fs.readFileSync(path.join(root, 'egybook-reels-return-recovery.js'), 'utf8');
const reelsSource = fs.readFileSync(path.join(root, 'egybook-reels-experience.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

function setup() {
  const modal = { dataset: { evpSuspendedForRoute: 'true', postId: 'post-10' } };
  const player = { readyState: 1, videoWidth: 0, videoHeight: 0, networkState: 2, error: null };
  const document = { getElementById(id) { return id === 'egybookVideoModal' ? modal : (id === 'egybookVideoPlayer' ? player : null); } };
  const window = {};
  vm.runInNewContext(recoverySource, { window, document, Promise, String, Number, Object, Error });
  return { window, document, modal, player, api: window.EgyBookReelsReturnRecoveryV232 };
}

(async () => {
  const x = setup();
  assert.strictEqual(x.api.version, '232.0', 'independent recovery coordinator is versioned');
  assert.strictEqual(x.api.hasPresentableFrame(x.player), false, 'metadata-only player is not treated as visible video');
  assert.strictEqual(x.api.shouldFallback(x.modal, x.player), true, 'suspended player without decoded frame takes fallback');
  x.player.readyState = 2; x.player.videoWidth = 720; x.player.videoHeight = 1280;
  assert.strictEqual(x.api.hasPresentableFrame(x.player), true, 'decoded video frame is recognized');
  assert.strictEqual(x.api.shouldFallback(x.modal, x.player), false, 'healthy retained frame keeps same-video resume path');
  x.modal.dataset.evpResumeFailed = 'true';
  assert.strictEqual(x.api.shouldFallback(x.modal, x.player), true, 'explicit failed resume triggers fallback even when metadata remains');

  let called = null;
  x.window.EgyBookVideoSourceManager = {
    openReels(options) { called = options; return Promise.resolve({ ok: true, post: { dataset: { postId: 'post-20' } } }); }
  };
  const result = await x.api.recover({ routeToken: 7, isCurrent: () => true });
  assert.strictEqual(result.ok, true, 'coordinator returns successful catalog fallback');
  assert.strictEqual(called.preferredPostId, 'post-10', 'previously selected Reel is preferred on return');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(called, 'excludePostId'), false, 'recovery no longer skips the selected Reel');
  assert.strictEqual(called.fallbackFromNavigation, true, 'fallback intent reaches the existing source manager');
  assert.strictEqual(x.modal.dataset.evpResumeFailureReason, 'previous-resume-failed', 'failure reason is recorded without media secrets');

  const stale = setup();
  let staleCalls = 0;
  stale.window.EgyBookVideoSourceManager = { openReels() { staleCalls++; return Promise.resolve({ ok: true }); } };
  const staleResult = await stale.api.recover({ routeToken: 8, isCurrent: () => false });
  assert.strictEqual(staleResult.stale, true, 'stale route cannot open a fallback player');
  assert.strictEqual(staleCalls, 0, 'stale route does not request source-manager work');

  const fallbackHook = reelsSource.indexOf('returnRecovery?.shouldFallback?.(modal,retainedPlayer)');
  const resumeHook = reelsSource.indexOf('resumeFromNavigation?.()', fallbackHook);
  assert.ok(fallbackHook >= 0 && resumeHook > fallbackHook, 'frame fallback is evaluated before exposing the retained player');
  assert.match(reelsSource, /Number\(player\.readyState\)>=2&&Number\(player\.videoWidth\)>0&&Number\(player\.videoHeight\)>0/, 'healthy retained player requires a decoded frame');
  assert.ok(mainSource.includes("const preferredPostId=String(options.preferredPostId||modalForRecovery?.dataset?.evpRecoveryPostId||modalForRecovery?.dataset?.postId||'')"), 'source manager honors the selected Reel identity');
  assert.match(mainSource, /const first=preferred\|\|state\.items\[0\]/, 'selected Reel is reopened first when still available');
  assert.match(mainSource, /recoverFromNavigation\?\.\(first\.post,\{fallback:options\.fallbackFromNavigation===true\}\)/, 'fallback remains inside the existing canonical player recovery path');
  assert.match(mainSource, /const opened=recoveringRetainedSession\?recovered:/, 'failed retained-session recovery cannot fall through to a generic player open');
  assert.match(mainSource, /time:0,\s*audioTime:0,\s*sourceAudioTime:0/, 'fallback restarts all media from 0:00');
  assert.match(mainSource, /resumePolicy:'restart-from-start'/, 'route recovery explicitly selects restart-from-start policy');
  assert.match(mainSource, /activateIndependentVideoQueue\(post,'reels'\)/, 'selected fallback updates the existing vertical swipe queue');
  assert.match(mainSource, /returnCover=canvas\.toDataURL\('image\/jpeg',0\.78\)/, 'navigation keeps the bounded real-frame fallback cover');
  assert.match(mainSource, /fallbackCoverSrc:String\(saved\.returnCover\|\|''\)/, 'fallback carries the retained frame into the canonical player');
  assert.match(mainSource, /resumeState\?\.fallbackCover===true[\s\S]*?resumeState\?\.fallbackCoverSrc/, 'only Reels route recovery can request its real retained frame');
  assert.match(mainSource, /poster\.src=resumeState\.fallbackCoverSrc\.trim\(\);[\s\S]*?poster\.classList\.add\('evp-video-opening-cover'\)/, 'Reels recovery uses the real retained frame, not a synthetic background');
  assert.match(mainSource, /routeRecoveryFrame&&poster\?\.isConnected[\s\S]*?onPresented:[\s\S]*?poster\.hidden=true/, 'the retained Reels frame is removed only after the replacement frame is presented');
  assert.doesNotMatch(mainSource, /getPlaceholderSrc|openingCover|openingFrameCover/, 'the direct preview open path has no generated placeholder or screenshot cover');
  assert.match(mainSource, /if\(!state\.items\.length&&state\.loading\)/, 'catalog wait only blocks when there is no cached reel to show');
  assert.ok(indexSource.includes('egybook-reels-return-recovery.js?v=232-instant-return-fallback'), 'new independent module is loaded');
  assert.ok(indexSource.indexOf('egybook-reels-return-recovery.js?v=232-instant-return-fallback') < indexSource.indexOf('egybook-reels-experience.js?v=232-return-frame-recovery'), 'recovery module is loaded before the Reels route coordinator');
  assert.ok(swSource.includes('egybook-reels-return-recovery.js?v=232-instant-return-fallback'), 'new independent module is included in Service Worker core assets');
  assert.ok(swSource.includes('2026-11-egybook-v247-render-and-reels-load'), 'Service Worker cache version advances to V245 without removing the V232 recovery module');

  console.log('V232 Reels return recovery tests: PASS 29/29');
})().catch(error => { console.error(error); process.exitCode = 1; });
