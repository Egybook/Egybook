const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-reels-rail-guard.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'egybook-reels-rail-guard.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class FakeClassList {
  constructor(node, initial = []) { this.node = node; this.valuesSet = new Set(initial); }
  add(value) { this.valuesSet.add(value); }
  remove(value) { this.valuesSet.delete(value); }
  contains(value) { return this.valuesSet.has(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.contains(value) : !!force;
    if (shouldAdd) this.add(value); else this.remove(value);
    return shouldAdd;
  }
}
class FakeStyle {
  constructor() { this.display = ''; this.visibility = ''; this.opacity = ''; this.backgroundImage = ''; }
  removeProperty(name) { const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); this[key] = ''; }
}
class FakeNode {
  constructor({ id = '', classes = [], dataset = {}, text = '', hidden = false } = {}) {
    this.id = id; this.classList = new FakeClassList(this, classes); this.dataset = { ...dataset };
    this.textContent = text; this.hidden = hidden; this.attributes = new Map(); this.style = new FakeStyle();
    this.isConnected = true; this.selectors = new Map(); this.children = [];
    if (hidden) this.attributes.set('hidden', '');
  }
  querySelector(selector) { return this.selectors.get(selector) || null; }
  querySelectorAll(selector) { return this.selectors.get(selector) || []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'hidden') this.hidden = false; }
  hasAttribute(name) { return this.attributes.has(name); }
}
class FakeMutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }

const modal = new FakeNode({ id: 'egybookVideoModal', classes: ['open', 'evp-reels-context'], dataset: { mediaKind: 'video', postId: 'reel-1' } });
const box = new FakeNode({ id: 'egybookVideoBox', classes: ['evp-controls-hidden'] });
const comments = new FakeNode({ id: 'commentsModal', hidden: true });
const rail = new FakeNode({ id: 'evpPostRail', classes: ['evp-post-rail', 'evp-chrome'], hidden: true });
const creator = new FakeNode();
const reactionWrap = new FakeNode();
const authorName = new FakeNode({ id: 'evpAuthorName', text: 'قديم' });
const authorAvatar = new FakeNode({ id: 'evpAuthorAvatar' });
const likeButton = new FakeNode();
const commentButton = new FakeNode();
const shareButton = new FakeNode();
const saveButton = new FakeNode();
const saveLabel = new FakeNode({ text: 'حفظ' });
saveButton.selectors.set('small', saveLabel);
rail.selectors.set('.evp-creator', creator);
rail.selectors.set('.evp-reaction-wrap', reactionWrap);
rail.selectors.set('[data-evp="post-like"]', likeButton);
rail.selectors.set('[data-evp="post-comment"]', commentButton);
rail.selectors.set('[data-evp="post-share"]', shareButton);
rail.selectors.set('[data-evp="post-save"]', saveButton);
rail.selectors.set('#evpAuthorAvatar', authorAvatar);
rail.selectors.set('#evpAuthorName', authorName);

const sourceName = new FakeNode({ text: 'صاحب الريل' });
const sourceAvatar = new FakeNode(); sourceAvatar.style.backgroundImage = 'url("avatar.jpg")';
const sourceLike = new FakeNode({ dataset: { currentReaction: '❤️' } });
const sourceSave = new FakeNode({ classes: ['saved'] });
const post = new FakeNode({ dataset: { postId: 'reel-1' } });
post.selectors.set('.post-author .author-name', sourceName);
post.selectors.set('.post-header .avatar', sourceAvatar);
post.selectors.set('[data-action="like"]', sourceLike);
post.selectors.set('[data-action="save"]', sourceSave);

const document = {
  querySelector(selector) {
    return new Map([
      ['#egybookVideoModal', modal], ['#egybookVideoBox', box],
      ['#evpPostRail', rail], ['#commentsModal', comments]
    ]).get(selector) || null;
  },
  querySelectorAll(selector) { return selector === '.post[data-post-id]' ? [post] : []; }
};
const listeners = new Map();
const window = {
  addEventListener(type, callback) { listeners.set(type, callback); },
  visualViewport: null
};
const context = {
  window, document, MutationObserver: FakeMutationObserver,
  requestAnimationFrame(callback) { callback(); },
  String, Object, Array
};
vm.runInNewContext(moduleSource, context, { filename: 'egybook-reels-rail-guard.js' });
const api = window.EgyBookReelsRailGuard;
assert.ok(api, 'guard module registers its public diagnostic hook');
assert.strictEqual(api.version, '235');

assert.strictEqual(api.refresh(), true, 'active Reels video binds its matching post');
assert.strictEqual(rail.hidden, false, 'hidden rail is restored');
assert.strictEqual(box.classList.contains('evp-reels-rail-ready'), true, 'Reels-only visibility state is enabled');
assert.strictEqual(authorName.textContent, 'صاحب الريل', 'active author name is refreshed');
assert.strictEqual(authorAvatar.style.backgroundImage, 'url("avatar.jpg")', 'active author avatar is refreshed');
assert.strictEqual(likeButton.dataset.currentReaction, '❤️', 'existing reaction state is mirrored');
assert.strictEqual(likeButton.getAttribute('aria-pressed'), 'true');
assert.strictEqual(saveButton.classList.contains('is-active'), true, 'existing saved state is mirrored');
assert.strictEqual(saveLabel.textContent, 'تم الحفظ');
assert.strictEqual(api.getState().requiredNodesPresent, true, 'the existing action nodes are retained');

// Recover the exact failure mode reported by the user: action nodes and the
// creator label have acquired hidden/display/visibility state while avatar and
// settings survive. The guard must restore only the existing rail controls.
for (const node of [creator, reactionWrap, likeButton, commentButton, shareButton, saveButton, authorName]) {
  node.hidden = true;
  node.setAttribute('hidden', '');
  node.style.display = 'none';
  node.style.visibility = 'hidden';
  node.style.opacity = '0';
}
assert.strictEqual(api.refresh(), true, 'hidden social controls are reconciled on the active Reel');
for (const node of [creator, reactionWrap, likeButton, commentButton, shareButton, saveButton, authorName]) {
  assert.strictEqual(node.hidden, false, 'required social control hidden property is cleared');
  assert.strictEqual(node.hasAttribute('hidden'), false, 'required social control hidden attribute is cleared');
  assert.strictEqual(node.style.display, '', 'inline display suppression is cleared');
  assert.strictEqual(node.style.visibility, '', 'inline visibility suppression is cleared');
  assert.strictEqual(node.style.opacity, '', 'inline opacity suppression is cleared');
}

// A stale player comment flag must not keep the social rail hidden after the
// comments overlay has closed.
box.classList.add('evp-comments-open');
assert.strictEqual(api.refresh(), true);
assert.strictEqual(box.classList.contains('evp-comments-open'), false, 'stale comments-open state is cleared');
assert.strictEqual(box.classList.contains('evp-reels-rail-ready'), true);

// While the actual Reels comments sheet is open, preserve its intentional
// compact-video behavior and do not force the rail over the comments sheet.
comments.hidden = false;
comments.classList.add('open');
comments.classList.add('evp-comments-overlay');
assert.strictEqual(api.refresh(), false, 'real comments overlay retains its existing layout');
assert.strictEqual(box.classList.contains('evp-reels-rail-ready'), false);
comments.hidden = true;
comments.classList.remove('open');
comments.classList.remove('evp-comments-overlay');
assert.strictEqual(api.refresh(), true, 'rail returns after comments close');

// The module is inert outside the Reels video context.
modal.dataset.mediaKind = 'image';
assert.strictEqual(api.refresh(), false, 'non-video media is not affected');
assert.strictEqual(box.classList.contains('evp-reels-rail-ready'), false);
modal.dataset.mediaKind = 'video';
modal.classList.remove('open');
assert.strictEqual(api.refresh(), false, 'a closed player is not affected');

assert.match(cssSource, /evp-reels-rail-ready #evpPostRail/);
assert.match(cssSource, /#evpAuthorName\s*\{/);
assert.match(cssSource, /data-evp="post-comment"/);
assert.match(cssSource, /data-evp="post-share"/);
assert.match(cssSource, /data-evp="post-save"/);
assert.ok(htmlSource.includes('egybook-reels-rail-guard.css?v=235-reels-social-rail-persistence'));
assert.ok(htmlSource.includes('egybook-reels-rail-guard.js?v=235-reels-social-rail-persistence'));
assert.ok(swSource.includes('egybook-reels-rail-guard.css?v=235-reels-social-rail-persistence'));
assert.ok(swSource.includes('egybook-reels-rail-guard.js?v=235-reels-social-rail-persistence'));
assert.ok(swSource.includes('2026-11-egybook-v247-render-and-reels-load'));
assert.strictEqual((htmlSource.match(/id="evpPostRail"/g) || []).length, 1, 'only one shared action rail remains');

console.log('V235 Reels Social Rail Persistence: PASS 38/38');
