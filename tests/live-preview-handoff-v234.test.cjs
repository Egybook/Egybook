const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'egybook-live-preview-handoff.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'egybook-live-preview-handoff.css'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

class FakeClassList {
  constructor(node) { this.node = node; }
  values() { return new Set(String(this.node.attributes.get('class') || '').split(/\s+/).filter(Boolean)); }
  add(value) { const values = this.values(); values.add(value); this.node.attributes.set('class', [...values].join(' ')); }
  remove(value) { const values = this.values(); values.delete(value); this.node.attributes.set('class', [...values].join(' ')); }
  contains(value) { return this.values().has(value); }
}
class FakeNode {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.attributes = new Map(); this.children = []; this.parentNode = null; this.dataset = {}; this.classList = new FakeClassList(this); this.isConnected = true; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
  insertBefore(child, before) { if (child.parentNode) child.parentNode.removeChild(child); const at = before ? this.children.indexOf(before) : -1; if (at < 0) this.children.push(child); else this.children.splice(at, 0, child); child.parentNode = this; return child; }
  removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; }
  get nextSibling() { if (!this.parentNode) return null; const list = this.parentNode.children; return list[list.indexOf(this) + 1] || null; }
  set className(value) { this.setAttribute('class', value); }
  get className() { return this.getAttribute('class') || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set textContent(value) { this._text = String(value); }
  remove() { this.parentNode?.removeChild(this); }
}

const document = { createElement: tag => new FakeNode(tag) };
const window = {};
vm.runInNewContext(moduleSource, { window, document, WeakMap, Object, String, Number });
const api = window.EgyBookLivePreviewHandoffV234;
assert.strictEqual(api.version, '234.0');

const feedCard = new FakeNode('article');
const before = new FakeNode('span');
const video = new FakeNode('video');
video.readyState = 2;
video.videoWidth = 720;
video.videoHeight = 1280;
video.error = null;
video.currentTime = 12.4;
video.paused = false;
video.pause = () => { video.paused = true; };
video.setAttribute('class', 'post-image egybook-feed-video');
feedCard.appendChild(video);
feedCard.appendChild(before);
const box = new FakeNode('div');

const lease = api.promote(video, box);
assert.ok(lease, 'decoded feed media is eligible for promotion');
assert.strictEqual(lease.video, video, 'handoff retains the exact same HTMLVideoElement object');
assert.strictEqual(video.parentNode, lease.wrapper, 'video is temporarily moved into the existing player stage');
assert.strictEqual(box.children[0], lease.wrapper, 'handoff surface is attached to the player stage');
assert.ok(video.classList.contains('evp-live-preview-handoff-video'), 'handoff class is scoped to the promoted element');
assert.strictEqual(api.isActive(lease), true);

assert.strictEqual(api.complete(lease, { time: 12.7 }), true, 'matching player frame completes handoff');
assert.strictEqual(video.parentNode, feedCard, 'same video element returns to its exact original parent');
assert.strictEqual(video.nextSibling, before, 'original sibling position is restored');
assert.strictEqual(video.className, 'post-image egybook-feed-video', 'original class list is restored');
assert.strictEqual(video.paused, true, 'preview stays paused after the canonical player takes over');
assert.ok(Math.abs(video.currentTime - 12.7) < 0.001, 'preview playhead aligns to canonical handoff time');
assert.strictEqual(api.isActive(lease), false);
assert.strictEqual(api.restore(lease), false, 'completed handoff cannot be restored twice');

const video2 = new FakeNode('video');
video2.readyState = 2; video2.videoWidth = 1080; video2.videoHeight = 1920; video2.error = null; video2.currentTime = 3; video2.paused = true; video2.pause = () => { video2.paused = true; };
video2.setAttribute('class', 'post-image egybook-feed-video');
feedCard.insertBefore(video2, before);
const lease2 = api.promote(video2, box);
assert.ok(lease2, 'second preview can be promoted after the first session');
assert.strictEqual(api.restore(lease2), true, 'cancel returns a preview to the feed');
assert.strictEqual(video2.parentNode, feedCard);
assert.strictEqual(video2.className, 'post-image egybook-feed-video');

const notReady = new FakeNode('video');
notReady.readyState = 1; notReady.videoWidth = 0; notReady.videoHeight = 0; notReady.error = null;
feedCard.appendChild(notReady);
assert.strictEqual(api.promote(notReady, box), null, 'un-decoded preview is not promoted as a blank surface');

assert.match(mainSource, /if\(!reusePlayerSource\)player\.src=requestedSource/, 'same-source reopen skips a second src assignment');
assert.match(mainSource, /if\(p\)\{p\.pause\(\);p\.preload='metadata';p\.hidden=false;\}/, 'close retains the canonical player resource instead of clearing it');
assert.match(mainSource, /feedVideoObserver\?\.unobserve\(origin\)/, 'feed observer is detached while the exact element is in the player stage');
assert.match(mainSource, /feedVideos\.delete\(origin\)[\s\S]*?feedVideoCandidates\.delete\(origin\)/, 'promoted preview is removed from feed autoplay arbitration while the modal is open');
assert.match(mainSource, /if\(origin\?\.video\?\.isConnected\)\{\s*feedVideos\.add\(origin\.video\);\s*feedVideoObserver\?\.observe\(origin\.video\);/, 'feed registration is restored only after the modal closes');
assert.doesNotMatch(mainSource, /openingFrameCover|frameCanvas\.toDataURL|getPlaceholderSrc/, 'video opening contains no screenshot or branded placeholder path');
const closeBlock = mainSource.slice(mainSource.indexOf('function closeEgyBookVideo('), mainSource.indexOf('function exitReelsPlayerForNavigation('));
assert.doesNotMatch(closeBlock, /p\.removeAttribute\('src'\)|p\.load\(\)/, 'closing the canonical video does not clear or restart its media resource');
assert.match(cssSource, /background:transparent!important/, 'handoff surface has no decorative background');
assert.doesNotMatch(cssSource, /linear-gradient|radial-gradient|data:image/, 'handoff CSS defines no synthetic image or gradient backdrop');
assert.ok(htmlSource.includes('egybook-live-preview-handoff.js?v=234-live-preview-handoff'));
assert.ok(htmlSource.includes('egybook-live-preview-handoff.css?v=234-live-preview-handoff'));
assert.ok(swSource.includes('egybook-live-preview-handoff.js?v=234-live-preview-handoff'));
assert.ok(swSource.includes('egybook-live-preview-handoff.css?v=234-live-preview-handoff'));
assert.ok(swSource.includes('2026-11-egybook-v243-incoming-audio-guard'));

console.log('V234 Live Preview Handoff: PASS 28/28');
