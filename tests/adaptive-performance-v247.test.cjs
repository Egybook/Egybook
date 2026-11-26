'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const adaptationSource = fs.readFileSync(path.join(root, 'egybook-video-adaptation.js'), 'utf8');
const swipeSource = fs.readFileSync(path.join(root, 'swipe-navigation.js'), 'utf8');
const scriptSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

function createAdaptation({ pressure = false, preloadMode = 'auto', enabled = false, effectiveType = '4g', saveData = false } = {}) {
  const window = {
    EgyBookDataSaver: {
      getSettings: () => ({ enabled, preloadMode }),
      isEnabled: () => enabled
    },
    EgyBookPerformance: { getSnapshot: () => ({ pressure, signalConfidence: 'two-hints', deviceTier: 'L4' }) }
  };
  const navigator = {
    connection: { effectiveType, rtt: 40, downlink: 12, saveData },
    deviceMemory: 8, hardwareConcurrency: 12, onLine: true
  };
  const sandbox = { window, navigator, Number, String, Object };
  vm.runInNewContext(adaptationSource, sandbox, { filename: 'egybook-video-adaptation.js' });
  return window.EgyBookVideoAdaptation;
}

// Capable device: only the next adjacent item receives an automatic hint.
{
  const api = createAdaptation();
  assert.equal(api.version, 247);
  assert.equal(api.getAdjacentPreloadMode('next'), 'auto');
  assert.equal(api.getAdjacentPreloadMode('previous'), 'metadata');
}

// Runtime pressure and constrained connections reduce adjacent work, not the active player.
{
  const api = createAdaptation({ pressure: true });
  assert.equal(api.getAdjacentPreloadMode('next'), 'metadata');
  assert.equal(api.getAdjacentPreloadMode('previous'), 'metadata');
}
{
  const api = createAdaptation({ effectiveType: '2g' });
  assert.equal(api.getAdjacentPreloadMode('next'), 'metadata');
}

// Explicit user preferences override the adaptive default.
{
  const api = createAdaptation({ pressure: true, preloadMode: 'none' });
  assert.equal(api.getAdjacentPreloadMode('next'), 'none');
}
{
  const api = createAdaptation({ preloadMode: 'metadata' });
  assert.equal(api.getAdjacentPreloadMode('next'), 'metadata');
}

// Swipe previews, warm cache, and canonical queue now use one shared policy.
assert.ok(swipeSource.includes("media.preload=getAdjacentPreloadMode(direction>0?'next':'previous')"));
assert.ok(swipeSource.includes("window.EgyBookVideoAdaptation?.getAdjacentPreloadMode?.(priority)"));
assert.equal(/media\.preload\s*=\s*'auto'/.test(swipeSource), false);
assert.equal((scriptSource.match(/getAdjacentPreloadMode\?\.\('next'\)/g) || []).length, 2);

// Profile card creation yields between small groups and uses a keyed node map.
assert.ok(scriptSource.includes('const PROFILE_RENDER_BATCH_SIZE=8;'));
assert.ok(scriptSource.includes('await yieldProfileRenderTurn();'));
assert.ok(scriptSource.includes('const cachedPostNodes=new Map('));
assert.ok(scriptSource.includes('const profilePostNodes=new Map('));
assert.ok(scriptSource.includes('if(!isCurrentProfilePostsRequest())return;'));

// Initial viewport stats requests are bounded instead of launching an unbounded burst.
assert.ok(scriptSource.includes('const POST_STATS_MAX_CONCURRENT=2;'));
assert.ok(scriptSource.includes('function drainPostStatsQueue(){'));
assert.ok(scriptSource.includes('enqueuePostStatsLoad(target);'));
assert.ok(scriptSource.includes('postStatsInFlight<POST_STATS_MAX_CONCURRENT'));

// Reels startup diagnostics expose stage timings only when the opt-in video debug hook exists.
assert.ok(scriptSource.includes("'reels_catalog_pipeline'"));
assert.ok(scriptSource.includes("'reels_queue_ready'"));
assert.ok(scriptSource.includes("'reels_first_item_selected'"));

// Versioned shell resources point to the same implementation and cache generation.
assert.ok(html.includes('script.js?v=247-profile-render-budget'));
assert.ok(html.includes('egybook-video-adaptation.js?v=247-unified-adjacent-preload'));
assert.ok(html.includes('swipe-navigation.js?v=247-adaptive-preview-preload'));
assert.ok(sw.includes("const VERSION = '2026-11-egybook-v247-render-and-reels-load'"));
assert.ok(sw.includes('script.js?v=247-profile-render-budget'));
assert.ok(sw.includes('egybook-video-adaptation.js?v=247-unified-adjacent-preload'));
assert.ok(sw.includes('swipe-navigation.js?v=247-adaptive-preview-preload'));

console.log('EgyBook V247 render budget + Reels preload policy: PASS 27 assertions');
