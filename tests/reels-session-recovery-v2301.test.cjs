const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const healthSource = fs.readFileSync(path.join(root, 'egybook-reels-session-health.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const reelsSource = fs.readFileSync(path.join(root, 'egybook-reels-experience.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

const window = {};
vm.runInNewContext(healthSource, { window, String, Number, Object });
const inspect = window.EgyBookReelsSessionHealth.inspect;

function media(overrides = {}) {
  return {
    currentSrc: '', src: '', readyState: 0, networkState: 0, error: null,
    dataset: {}, getAttribute(name) { return name === 'src' ? this.src : null; },
    ...overrides
  };
}

let result = inspect({}, media());
assert.strictEqual(result.status, 'missing-source', 'empty retained player is not considered healthy');
result = inspect({}, media({ src: 'https://media.example/reel.mp4', error: { code: 2 } }));
assert.strictEqual(result.status, 'failed', 'media error is classified as failed');
result = inspect({}, media({ src: 'https://media.example/reel.mp4', networkState: 3 }));
assert.strictEqual(result.status, 'failed', 'NETWORK_NO_SOURCE is classified as failed');
result = inspect({}, media({ src: 'https://media.example/reel.mp4', readyState: 0, networkState: 2 }));
assert.strictEqual(result.status, 'loading', 'valid in-flight load remains eligible for keep-alive');
result = inspect({}, media({ src: 'https://media.example/reel.mp4', readyState: 1, networkState: 1 }));
assert.strictEqual(result.status, 'ready', 'metadata-ready retained player is healthy');

assert(mainSource.includes("modal.dataset.evpResumeFailed='true'"), 'failed resume state is recorded');
assert(mainSource.includes("metadataTimeoutId=setTimeout(()=>failRestore('metadata-timeout'),10000)"), 'stalled metadata recovery is bounded');
assert(mainSource.includes("player.addEventListener('error',onFailure)"), 'media errors release the retained route lock');
assert(mainSource.includes('recoverFromNavigation(post)'), 'same canonical player recovery path exists');
assert(mainSource.includes('hideRetainedReelsSurface(modal,player)'), 'failed recovery hides the empty player shell');
assert(mainSource.includes('window.EgyBookReelsExperience?.refresh?.();'), 'recovery retry is routed through the Reels coordinator');
assert(mainSource.includes('const preferredPostId=String(modalForRecovery?.dataset?.evpRecoveryPostId||modalForRecovery?.dataset?.postId||\'\')'), 'recovery prefers the exact previously open post');
assert(reelsSource.includes('function hasHealthyRetainedPlayer()'), 'Reels mount validates the current retained player');
assert(reelsSource.includes('if(hasHealthyRetainedPlayer())return Promise.resolve(true);'), 'only a healthy open modal short-circuits remount');
assert(mainSource.includes("const timeoutId=controller?setTimeout(()=>controller.abort(),12000):0"), 'catalog fetch has a bounded network wait');
assert(indexSource.includes('egybook-reels-session-health.js?v=2301-player-health-guard'), 'health module is loaded before the main script');
assert(swSource.includes('egybook-reels-session-health.js?v=2301-player-health-guard'), 'health module is precached');
assert(swSource.includes('2026-11-egybook-v230-2-seamless-route-restore'), 'service worker cache version includes the V230.2 route restoration release');

console.log('V230.1 Reels session recovery tests: PASS 18/18');
