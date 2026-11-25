'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const core = read('script.js');
const sw = read('service-worker.js');
const pull = read('egybook-pull-to-refresh.js');
const chat = read('egybook-chat-viewport.js');
const selection = read('egybook-selection-guard.js');
const viewer = read('egybook-image-viewer-longpress.js');

const pos = value => html.indexOf(value);
const pullTag = 'egybook-pull-to-refresh.js?v=244-pull-refresh-module';
const coreTag = 'script.js?v=244-modular-core';
const chatTag = 'egybook-chat-viewport.js?v=244-chat-viewport-raf';
const selectionTag = 'egybook-selection-guard.js?v=244-selection-guard';
const viewerTag = 'egybook-image-viewer-longpress.js?v=244-image-viewer-longpress';
assert.ok(pos(pullTag) >= 0 && pos(pullTag) < pos(coreTag), 'pull-refresh module loads before the core initializer');
assert.ok(pos(coreTag) < pos(chatTag) && pos(chatTag) < pos(selectionTag) && pos(selectionTag) < pos(viewerTag), 'standalone modules execute after the core in their original sequence');
assert.ok(core.includes('window.EgyBookPullRefresh?.init({'), 'core injects live app dependencies into the pull-refresh module');
assert.ok(!core.includes('Unified in-app pull-to-refresh for Home and Profile.'), 'the full pull-refresh implementation is no longer embedded in script.js');
assert.ok(!core.includes('Keep the standalone chat fitted to the visible mobile viewport'), 'chat viewport code is removed from the core');
assert.ok(!core.includes('EgyBook stability: prevent accidental native text selection'), 'selection guard code is removed from the core');
assert.ok(!core.includes('EgyBook v77: long-press/context-menu opens the branded photo options'), 'image viewer long-press code is removed from the core');
assert.ok(pull.includes('window.EgyBookPullRefresh = Object.freeze({ version: 1, init })'), 'pull-refresh module exposes a versioned init API');
assert.ok(pull.includes("document.addEventListener('touchmove'") && pull.includes('{ passive: true, capture: true }'), 'pull-refresh keeps passive capture touch handling');
assert.ok(pull.includes('getCurrentPage()') && pull.includes('getCurrentUser()') && pull.includes('getSupabase()'), 'pull-refresh reads live state through injected getters');
assert.ok(chat.includes('window.requestAnimationFrame(syncChatViewport)'), 'chat viewport work is coalesced to animation frames');
assert.ok(chat.includes("getPropertyValue('--egy-chat-viewport-height') !== value"), 'chat viewport avoids redundant CSS variable writes');
assert.ok(selection.includes('input, textarea, select') && selection.includes('.allow-native-selection'), 'selection guard preserves editable/native-selection exceptions');
assert.ok(viewer.includes("['pointerup', 'pointercancel', 'pointerleave']"), 'image viewer long-press clears on all release/cancel paths');
for (const asset of [pullTag, coreTag, chatTag, selectionTag, viewerTag]) assert.ok(sw.includes(asset), `Service Worker precaches ${asset}`);
assert.ok(sw.includes("const VERSION = '2026-11-egybook-v246-adaptive-device-load-guard'"), 'Service Worker cache generation advances for the new modules');
assert.ok(!/\.topbar|\.bottom-navigation|topbar|bottom-navigation/.test(pull + chat + selection + viewer), 'new feature modules do not modify either navigation bar');

// Verify that the extracted pull-refresh module exposes a usable API and
// registers the existing touch gesture as passive/capture without touching app state.
const listenerMap = new Map();
const documentStub = {
  documentElement: { style: {} },
  body: { style: {} },
  addEventListener(type, listener, options) {
    const items = listenerMap.get(type) || [];
    items.push({ listener, options });
    listenerMap.set(type, items);
  }
};
const windowStub = {};
vm.runInNewContext(pull, { window: windowStub, document: documentStub, console });
const inert = () => {};
const pullContext = {
  getCurrentPage: () => 'home', getCurrentUser: () => null, getSupabase: () => null,
  postsList: {}, restorePosts: inert, loadCloudPostStats: inert,
  getPublicProfileId: () => null, getPublicProfileIsOwn: () => false,
  restoreCloudProfile: inert, renderProfilePosts: inert, loadProfileFriends: inert,
  updateViewedProfilePresence: inert, showToast: inert
};
assert.equal(windowStub.EgyBookPullRefresh.init(pullContext), true, 'pull-refresh module initializes with explicit dependencies');
assert.equal(windowStub.EgyBookPullRefresh.init(pullContext), false, 'pull-refresh initialization is idempotent');
const moveRegistration = listenerMap.get('touchmove')?.[0];
assert.equal(moveRegistration?.options?.passive, true, 'touchmove remains passive');
assert.equal(moveRegistration?.options?.capture, true, 'touchmove remains capture-phase');
assert.equal(documentStub.documentElement.style.overscrollBehaviorY, 'none', 'document overscroll policy is preserved');
assert.equal(documentStub.body.style.overscrollBehaviorY, 'none', 'body overscroll policy is preserved');

console.log('EgyBook V244 Modular Interactions: PASS 24 assertions');
