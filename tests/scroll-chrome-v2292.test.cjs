'use strict';

/**
 * Regression test for the real scroll-chrome installer embedded in script.js.
 * It executes that installer against a small deterministic browser/DOM mock.
 * This verifies event ordering and both-bar movement, but is not a substitute
 * for a live Android Chrome / WebView / Safari device test.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');
const marker = '// EgyBook scroll chrome V9: preserve real scroll direction across browser-chrome resize.';
const endMarker = "    if(document.body?.dataset?.egybookActivePage&&!isEnabledPage())forceShow();\n  })();";
const start = source.indexOf(marker);
assert.notEqual(start, -1, 'scroll-chrome V9 installer marker exists');
const end = source.indexOf(endMarker, start);
assert.notEqual(end, -1, 'scroll-chrome V9 installer end marker exists');
const installer = source.slice(start, end + endMarker.length);

class EventHub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ type, ...event });
  }
}

class FakeStyle {
  constructor() { this.values = new Map(); this.transform = ''; }
  setProperty(name, value) { this.values.set(name, String(value)); }
  removeProperty(name) { const old = this.values.get(name) || ''; this.values.delete(name); return old; }
  getPropertyValue(name) { return this.values.get(name) || ''; }
}

function makeElement(height) {
  return {
    offsetHeight: height,
    style: new FakeStyle(),
    hidden: false,
    classList: {
      values: new Set(),
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
        if (enabled) this.values.add(name); else this.values.delete(name);
        return enabled;
      }
    }
  };
}

const rafQueue = [];
let rafId = 0;
const requestAnimationFrame = callback => { rafQueue.push({ id: ++rafId, callback }); return rafId; };
const cancelAnimationFrame = id => {
  const index = rafQueue.findIndex(item => item.id === id);
  if (index >= 0) rafQueue.splice(index, 1);
};
const flushFrames = () => {
  let safety = 0;
  while (rafQueue.length) {
    assert.ok(++safety < 30, 'RAF queue does not loop indefinitely');
    const frame = rafQueue.shift();
    frame.callback(16 * safety);
  }
};

const root = Object.assign(new EventHub(), { scrollTop: 0 });
const header = makeElement(70);
const bottom = makeElement(80);
const visualViewport = new EventHub();
const win = Object.assign(new EventHub(), {
  CSS: { supports: () => true },
  visualViewport,
  scrollY: 0,
  getComputedStyle: () => ({ transform: 'none', display: 'block', visibility: 'visible' })
});
const body = { dataset: { egybookActivePage: 'home' }, classList: { contains: () => false } };
const doc = Object.assign(new EventHub(), {
  body,
  activeElement: { tagName: 'BODY', isContentEditable: false },
  scrollingElement: root,
  documentElement: {},
  querySelector(selector) { return selector === '.topbar' ? header : selector === '.bottom-navigation' ? bottom : null; },
  querySelectorAll() { return []; },
  getElementById() { return null; }
});

const context = {
  window: win,
  document: doc,
  CSS: win.CSS,
  requestAnimationFrame,
  cancelAnimationFrame,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  parseFloat
};
vm.runInNewContext(`(function(){\n${installer}\n})();`, context, { timeout: 1000 });

const readState = () => ({
  topTranslate: header.style.getPropertyValue('translate'),
  bottomTranslate: bottom.style.getPropertyValue('translate'),
  topOpacity: Number(header.style.opacity),
  bottomOpacity: Number(bottom.style.opacity),
  hidden: header.classList.values.has('scroll-chrome-hidden') && bottom.classList.values.has('scroll-chrome-hidden')
});
const scrollTo = y => {
  root.scrollTop = y;
  win.scrollY = y;
  root.dispatch('scroll');
  flushFrames();
};

// 1) A downward feed scroll hides both bars in opposite directions.
scrollTo(180);
const hiddenState = readState();
assert.ok(hiddenState.topTranslate.startsWith('0 -'), 'top bar travels upward');
assert.ok(hiddenState.bottomTranslate.startsWith('0 '), 'bottom bar travels downward');
assert.equal(hiddenState.topOpacity, 0, 'top bar reaches hidden opacity');
assert.equal(hiddenState.bottomOpacity, 0, 'bottom bar reaches hidden opacity');

// 2) A viewport-only resize does not force-show or otherwise reset progress.
win.dispatch('resize');
visualViewport.dispatch('resize');
flushFrames();
const afterResizeOnly = readState();
assert.equal(afterResizeOnly.topTranslate, hiddenState.topTranslate, 'top hidden progress survives viewport resize');
assert.equal(afterResizeOnly.bottomTranslate, hiddenState.bottomTranslate, 'bottom hidden progress survives viewport resize');

// 3) Resize arrives after native scrollTop changed but before the scroll event.
//    The baseline must survive so the queued upward movement restores BOTH bars.
root.scrollTop = 145;
win.scrollY = 145;
win.dispatch('resize');
visualViewport.dispatch('resize');
root.dispatch('scroll');
flushFrames();
const restoredState = readState();
assert.ok(Number(restoredState.topTranslate.split(' ')[1].replace('px', '')) > Number(hiddenState.topTranslate.split(' ')[1].replace('px', '')), 'top bar begins returning after upward scroll');
assert.ok(Number(restoredState.bottomTranslate.split(' ')[1].replace('px', '')) < Number(hiddenState.bottomTranslate.split(' ')[1].replace('px', '')), 'bottom bar begins returning with top bar');
assert.ok(restoredState.topOpacity > hiddenState.topOpacity, 'top opacity restores progressively');
assert.ok(restoredState.bottomOpacity > hiddenState.bottomOpacity, 'bottom opacity restores progressively');

// 4) The controller remains scoped to Home/Profile; another page stays shown.
body.dataset.egybookActivePage = 'messages';
root.scrollTop = 100;
win.scrollY = 100;
root.dispatch('scroll');
flushFrames();
assert.equal(header.style.getPropertyValue('translate'), '0 0.00px', 'top bar remains shown outside Home/Profile');
assert.equal(bottom.style.getPropertyValue('translate'), '0 0.00px', 'bottom bar remains shown outside Home/Profile');

console.log('PASS 4/4 — actual V9 installer: paired movement, resize preservation, upward recovery, page scope');
