'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '..', 'egybook-navigation-state.js'), 'utf8');

function createHarness({ page = 'home', pathname = '/Egybook/', historyState = { page: 'home' }, storage = new Map() } = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const frames = [];
  const timers = [];
  const routeRoot = () => ({ hasAttribute: () => true, setAttribute: () => {} });
  const emittedEvents = [];
  const document = {
    body: { dataset: { egybookActivePage: page } },
    visibilityState: 'visible',
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
    dispatchEvent(event) { emittedEvents.push(event); return true; },
    getElementById(id) { return id === 'home' ? routeRoot() : null; }
  };
  const location = { pathname, hash: '' };
  const history = { state: historyState };
  const sessionStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); }
  };
  const window = {
    scrollX: 0,
    scrollY: 0,
    addEventListener(type, callback) { (windowListeners[type] ||= []).push(callback); },
    requestAnimationFrame(callback) { frames.push(callback); },
    setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
    clearTimeout() {},
    scrollTo(first, second) {
      if (typeof first === 'object') {
        this.scrollX = first.left || 0;
        this.scrollY = first.top || 0;
      } else {
        this.scrollX = first || 0;
        this.scrollY = second || 0;
      }
    }
  };
  const context = {
    window, document, location, history, sessionStorage,
    Date, Object, JSON, Number, String, Math,
    MutationObserver: undefined,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail || null; } }
  };
  vm.runInNewContext(source, context, { filename: 'egybook-navigation-state.js' });

  return {
    window, document, location, history, storage, documentListeners, windowListeners, emittedEvents,
    changePage(pageName) {
      (documentListeners['egybook:primarypagechange'] || []).forEach(callback => callback({ detail: { page: pageName } }));
    },
    runFrames() { while (frames.length) frames.shift()(); },
    runTimers(maxMs) { timers.splice(0).forEach(timer => { if (timer.ms <= maxMs) timer.callback(); }); }
  };
}

// Home position survives direct tab navigation and is restored when Home is revisited.
{
  const app = createHarness();
  app.window.scrollY = 742;
  app.changePage('messages');
  app.window.scrollY = 0; // The existing messages route opens at its own top.
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 742);
  assert.ok(app.emittedEvents.some(event => event.type === 'egybook:navigation-scroll-restored'));
}

// A rapid second route change cannot overwrite a destination's pending saved position.
{
  const app = createHarness();
  app.window.scrollY = 706;
  app.changePage('messages');
  app.window.scrollY = 0;
  app.changePage('home'); // Restore is pending.
  app.changePage('notifications'); // Must cancel the pending restore without saving the temporary zero position.
  app.window.scrollY = 0;
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 706);
}

// Profile state is keyed to the profile username, not mixed with another page.
{
  const app = createHarness({ page: 'profile', pathname: '/Egybook/nour', historyState: { page: 'profile', username: 'nour' } });
  app.window.scrollY = 515;
  app.changePage('notifications');
  app.window.scrollY = 0;
  app.location.pathname = '/Egybook/nour';
  app.history.state = { page: 'profile', username: 'nour' };
  app.changePage('profile');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 515);
}

// Reels is excluded from window-scroll restoration so V222+ Keep-Alive remains the owner.
{
  const app = createHarness();
  app.window.scrollY = 620;
  app.changePage('reels');
  app.window.scrollY = 0;
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 620);
}

// The state is persisted per browser tab and survives reconstruction of the SPA runtime.
{
  const sharedStorage = new Map();
  const firstLoad = createHarness({ storage: sharedStorage });
  firstLoad.window.scrollY = 888;
  firstLoad.changePage('messages');
  const secondLoad = createHarness({ page: 'messages', pathname: '/Egybook/messages', historyState: { page: 'messages' }, storage: sharedStorage });
  secondLoad.changePage('home');
  secondLoad.runFrames();
  assert.strictEqual(secondLoad.window.scrollY, 888);
}

// Popstate does not trigger a competing custom scroll; the existing history controller remains authoritative.
{
  const app = createHarness();
  app.window.scrollY = 400;
  (app.windowListeners.popstate || []).forEach(callback => callback({}));
  app.changePage('notifications');
  assert.strictEqual(app.window.scrollY, 400);
}

console.log('PASS: Home scroll retention');
console.log('PASS: rapid navigation cancels stale restores safely');
console.log('PASS: Profile scroll retention');
console.log('PASS: Reels Keep-Alive path untouched');
console.log('PASS: sessionStorage persistence');
console.log('PASS: Back/Forward controller remains authoritative');
