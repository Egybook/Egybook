'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'egybook-navigation-state.js'), 'utf8');

class MockElement {
  constructor(action) { this.action = action; }
  closest(selector) {
    const names = ['profile', 'messages', 'notifications'];
    if (selector.includes('[data-page]') && this.action === 'page') return this;
    if (names.some(name => selector.includes(`[data-action="${name}"]`) && this.action === name)) return this;
    return null;
  }
}

function createHarness({
  page = 'home',
  pathname = '/Egybook/',
  historyState = { page: 'home' },
  storage = new Map(),
  savedRoutes = null
} = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const frames = [];
  const timers = [];
  const emittedEvents = [];
  const rootIds = ['home', 'profilePage', 'messagesPage', 'notificationsPage', 'friendsDirectoryPage', 'reelsPage'];
  const roots = Object.fromEntries(rootIds.map(id => [id, {
    id, hidden: id !== ({ home: 'home', profile: 'profilePage', messages: 'messagesPage', notifications: 'notificationsPage', friends: 'friendsDirectoryPage', reels: 'reelsPage' }[page] || 'home'),
    isConnected: true,
    closest() { return null; },
    hasAttribute() { return true; },
    setAttribute() {}
  }]));
  const scrollingElement = { scrollLeft: 0, scrollTop: 0, scrollHeight: 4200, clientHeight: 700 };
  const document = {
    body: { dataset: { egybookActivePage: page }, scrollHeight: 4200 },
    documentElement: { scrollHeight: 4200, clientHeight: 700, scrollLeft: 0, scrollTop: 0 },
    scrollingElement,
    visibilityState: 'visible',
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
    dispatchEvent(event) { emittedEvents.push(event); return true; },
    querySelector(selector) { return roots[selector.replace('#', '')] || null; },
    getElementById(id) { return roots[id] || null; }
  };
  const location = { pathname, hash: '' };
  const history = { state: historyState };
  const sessionStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); }
  };
  const window = {
    Element: MockElement,
    scrollX: 0,
    scrollY: 0,
    innerHeight: 700,
    addEventListener(type, callback) { (windowListeners[type] ||= []).push(callback); },
    requestAnimationFrame(callback) { frames.push(callback); },
    setTimeout(callback, ms) { const id = timers.length + 1; timers.push({ id, callback, ms, cancelled: false }); return id; },
    clearTimeout(id) { const timer = timers.find(item => item.id === id); if (timer) timer.cancelled = true; },
    getComputedStyle(element) { return { display: element.hidden ? 'none' : 'block', visibility: 'visible' }; },
    scrollTo(first, second) {
      if (typeof first === 'object') {
        this.scrollX = Number(first.left) || 0;
        this.scrollY = Number(first.top) || 0;
      } else {
        this.scrollX = Number(first) || 0;
        this.scrollY = Number(second) || 0;
      }
      scrollingElement.scrollLeft = this.scrollX;
      scrollingElement.scrollTop = this.scrollY;
    }
  };

  if (savedRoutes) storage.set('egybook_navigation_scroll_v229_1', JSON.stringify({ version: 1, routes: savedRoutes }));

  const context = {
    window, document, location, history, sessionStorage,
    Element: MockElement,
    Date, Object, JSON, Number, String, Math, RegExp,
    MutationObserver: undefined,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail || null; } }
  };
  vm.runInNewContext(source, context, { filename: 'egybook-navigation-state.js' });

  function fireWindow(type, event = {}) { (windowListeners[type] || []).forEach(callback => callback(event)); }
  function changePage(nextPage, { hideBefore = true, username = null } = {}) {
    if (username) history.state = { page: nextPage, username };
    const oldPage = document.body.dataset.egybookActivePage;
    const nextRootId = ({ home: 'home', profile: 'profilePage', messages: 'messagesPage', notifications: 'notificationsPage', friends: 'friendsDirectoryPage', reels: 'reelsPage' }[nextPage] || 'home');
    if (hideBefore) Object.values(roots).forEach(root => { root.hidden = true; });
    document.body.dataset.egybookActivePage = nextPage;
    if (hideBefore) roots[nextRootId].hidden = false;
    (documentListeners['egybook:primarypagechange'] || []).forEach(callback => callback({ detail: { page: nextPage } }));
    if (!hideBefore) {
      roots[({ home: 'home', profile: 'profilePage', messages: 'messagesPage', notifications: 'notificationsPage', friends: 'friendsDirectoryPage', reels: 'reelsPage' }[oldPage] || 'home')].hidden = true;
      roots[nextRootId].hidden = false;
    }
  }
  function tapRoute(action) {
    const target = new MockElement(action);
    fireWindow('pointerdown', { target });
    fireWindow('click', { target });
  }
  function runFrames() { let guard = 0; while (frames.length && guard++ < 30) frames.shift()(); }
  function runTimers(maxMs = Infinity) {
    let guard = 0;
    while (guard++ < 100) {
      const index = timers.findIndex(timer => !timer.cancelled && timer.ms <= maxMs);
      if (index < 0) break;
      const [timer] = timers.splice(index, 1);
      timer.callback();
    }
  }

  return { window, document, roots, storage, documentListeners, windowListeners, emittedEvents, changePage, tapRoute, fireWindow, runFrames, runTimers };
}

// Home position is captured at the navigation tap before Messages hides Home.
{
  const app = createHarness();
  app.window.scrollY = 742;
  app.document.scrollingElement.scrollTop = 742;
  app.tapRoute('messages');
  assert.strictEqual(app.window.__egybookNavigationStateV2291.getSavedPosition('home').y, 742);
  app.changePage('messages');
  app.window.scrollY = 0;
  app.tapRoute('page');
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 742);
  assert.ok(app.emittedEvents.some(event => event.type === 'egybook:navigation-scroll-restored'));
}

// The pre-hide primary-page event also saves programmatic Profile transitions.
{
  const app = createHarness();
  app.window.scrollY = 1260;
  app.document.scrollingElement.scrollTop = 1260;
  app.changePage('profile', { hideBefore: false, username: 'nour' });
  assert.strictEqual(app.window.__egybookNavigationStateV2291.getSavedPosition('home').y, 1260);
  app.window.scrollY = 0;
  app.window.scrollTo({ top: 680 });
  app.tapRoute('messages');
  app.changePage('messages');
  assert.strictEqual(app.window.__egybookNavigationStateV2291.getSavedPosition('profile:nour').y, 680);
  app.changePage('profile', { username: 'nour' });
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 680);
}

// A route hidden before dispatch is not allowed to overwrite its saved scroll with zero.
{
  const app = createHarness();
  app.window.scrollY = 930;
  app.tapRoute('notifications');
  app.changePage('notifications');
  app.window.scrollY = 0;
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 930);
}

// Rapid route changes cancel the old restore and preserve the saved destination state.
{
  const app = createHarness();
  app.window.scrollY = 706;
  app.tapRoute('messages');
  app.changePage('messages');
  app.changePage('home');
  app.changePage('notifications');
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 706);
}

// A profile position is isolated by username.
{
  const app = createHarness({ page: 'profile', pathname: '/Egybook/nour', historyState: { page: 'profile', username: 'nour' } });
  app.window.scrollY = 515;
  app.tapRoute('notifications');
  app.changePage('notifications');
  assert.strictEqual(app.window.__egybookNavigationStateV2291.getSavedPosition('profile:nour').y, 515);
  app.window.scrollY = 0;
  app.changePage('profile', { username: 'nour' });
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 515);
}

// Reels remains excluded from document-scroll restoration.
{
  const app = createHarness();
  app.window.scrollY = 620;
  app.tapRoute('page');
  app.changePage('reels');
  app.window.scrollY = 0;
  app.changePage('home');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 620);
}

// A previously saved route is restored on a same-tab reload when its page is already available.
{
  const app = createHarness({ savedRoutes: { home: { x: 0, y: 888, savedAt: Date.now() } } });
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 888);
}

// Back/Forward restoration remains delegated to the existing history controller.
{
  const app = createHarness();
  app.window.scrollY = 400;
  app.fireWindow('popstate', {});
  app.changePage('notifications');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 400);
}

console.log('PASS: Home position captured before route handlers hide it');
console.log('PASS: Profile position captured per username');
console.log('PASS: hidden outgoing pages cannot overwrite saved positions');
console.log('PASS: rapid navigation cancels stale restores');
console.log('PASS: Reels remains outside document-scroll restoration');
console.log('PASS: same-tab reload can restore the last saved route');
console.log('PASS: Back/Forward remains under the legacy history controller');
