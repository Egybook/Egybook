'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { URL } = require('node:url');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-video-resource-identity.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

function normalizeHovodIdentity(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/v1\/secure-playback\/([A-Za-z0-9_-]{8,128})\//);
    return match ? `${url.origin}/v1/secure-playback/${match[1]}` : '';
  } catch (_) {
    return '';
  }
}

const window = {
  EgyBookVideoURLRenewalV231: {
    sameResource(first, second) {
      const a = normalizeHovodIdentity(first);
      const b = normalizeHovodIdentity(second);
      return !!a && a === b;
    }
  }
};
const document = { baseURI: 'https://egybook.example/Egybook/' };
vm.runInNewContext(moduleSource, { window, document, URL, String, Object });
const api = window.EgyBookVideoResourceIdentityV237;
assert.equal(api.version, '237.0');

const stableUrl = 'https://media.example/reels/clip-01.mp4';
const player = {
  src: stableUrl,
  currentSrc: stableUrl,
  getAttribute(name) { return name === 'src' ? this.src : null; }
};
const modal = { dataset: { postId: 'post-100' } };
const saved = { postId: 'post-100', source: stableUrl, time: 21.4 };
assert.equal(api.sameResource(stableUrl, stableUrl), true,
  'unchanged R2/media source is treated as the same resource');
assert.equal(api.sameResource(stableUrl, 'https://media.example/reels/clip-02.mp4'), false,
  'a different media path is not mistaken for the same resource');
assert.equal(api.matchesReelsSession(saved, modal, player), true,
  'the retained post and media source match the suspended Reels session');

const oldHovod = 'https://hovod.example/v1/secure-playback/playback_123456/master.m3u8?ticket=old';
const newHovod = 'https://hovod.example/v1/secure-playback/playback_123456/master.m3u8?ticket=rotated';
const otherHovod = 'https://hovod.example/v1/secure-playback/playback_654321/master.m3u8?ticket=rotated';
assert.equal(api.sameResource(oldHovod, newHovod), true,
  'Hovod ticket rotation preserves the underlying playback identity');
assert.equal(api.sameResource(oldHovod, otherHovod), false,
  'another Hovod playback ID remains a different resource');

player.src = newHovod;
player.currentSrc = newHovod;
assert.equal(api.matchesReelsSession({ ...saved, source: oldHovod }, modal, player), true,
  'a refreshed Hovod ticket does not invalidate the same suspended Reels session');
modal.dataset.postId = 'post-200';
assert.equal(api.matchesReelsSession(saved, modal, player), false,
  'a different post ID cannot inherit the previous Reels playhead or audio state');
modal.dataset.postId = 'post-100';
player.src = otherHovod;
player.currentSrc = otherHovod;
assert.equal(api.matchesReelsSession({ ...saved, source: oldHovod }, modal, player), false,
  'a different playback resource cannot inherit the previous Reels session');
assert.equal(api.matchesReelsSession({ ...saved, source: '' }, modal, player), false,
  'an empty saved source never authorizes a retained-session resume');

assert.match(mainSource, /if\(!resourceIdentity\?\.matchesReelsSession\?\.\(saved,modal,player\)\)/,
  'the canonical Reels resume path checks logical source and post identity before restoring state');
assert.match(mainSource, /cancel\?\.\(player,'reels-session-identity-mismatch'\)[\s\S]*?player\.pause\(\)/,
  'a mismatched hidden media context is stopped before Reels opens its own source');
assert.match(mainSource, /clearSuspendedReelsSession\(modal\)/,
  'stale suspended-session state is invalidated when another media context replaces the canonical player');
assert.match(mainSource, /identity\?\.sameResource/,
  'transition-cover release accepts an authorized Hovod ticket rotation for the same playback ID');
assert.match(mainSource, /sameResource\(currentAssigned,expectedSource\)[\s\S]*?sameResource\(currentResource,expectedSource\)/,
  'the transition cover validates both the assigned and active media resource identities');

const identityTag = '/Egybook/egybook-video-resource-identity.js?v=237-video-resource-identity';
const scriptTag = '/Egybook/script.js?v=247-profile-render-budget';
assert.ok(htmlSource.includes(identityTag), 'the resource-identity bridge is included in the app shell');
assert.ok(htmlSource.includes(scriptTag), 'the modified canonical player script receives a new asset version');
assert.ok(htmlSource.indexOf(identityTag) < htmlSource.indexOf(scriptTag),
  'the identity bridge loads before the canonical player code that consumes it');
assert.ok(swSource.includes("const VERSION = '2026-11-egybook-v247-render-and-reels-load';"),
  'Service Worker cache generation advances to V238.1');

const coreBlock = swSource.match(/const CORE_ASSETS = \[([\s\S]*?)\]\.map\(path/);
assert.ok(coreBlock, 'Service Worker core asset list is readable');
const coreEntries = [...coreBlock[1].matchAll(/'([^']*)'/g)].map(match => match[1]);
const corePaths = new Set(coreEntries.map(entry => new URL(entry || '.', 'https://egybook.example/Egybook/').pathname.replace(/^\/Egybook\//, '')));
const htmlPaths = new Set([...htmlSource.matchAll(/(?:src|href)=["']\/Egybook\/([^"'?#]+)(?:\?[^"']*)?["']/g)].map(match => match[1]));
const missing = [...htmlPaths].filter(asset => !corePaths.has(asset));
assert.deepEqual(missing, [], 'every same-origin CSS/JS/image/manifest reference in index.html is in the Service Worker core shell');
assert.ok(corePaths.has('egybook-video-resource-identity.js'), 'the new identity module is precached');
assert.ok(corePaths.has('evp-interaction-fix.js'), 'the existing video interaction owner is precached as well as linked');

console.log('V237 Video Resource Identity Guard: PASS 23/23');
