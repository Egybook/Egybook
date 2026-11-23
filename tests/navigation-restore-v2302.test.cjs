'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'egybook-navigation-state.js'), 'utf8');
const restoreCss = fs.readFileSync(path.join(__dirname, '..', 'egybook-navigation-restore.css'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const GATE = 'data-egybook-scroll-restore-pending';

class MockElement {
  constructor(action) { this.action = action; }
  closest(selector) {
    if (selector.includes('[data-page]') && this.action === 'page') return this;
    for (const name of ['profile', 'messages', 'notifications']) {
      if (selector.includes(`[data-action="${name}"]`) && this.action === name) return this;
    }
    return null;
  }
}

function createHarness({
  page = 'home',
  pathname = '/Egybook/',
  historyState = { page: 'home' },
  savedRoutes = null,
  scrollHeight = 4200
} = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const frames = [];
  const timers = [];
  const emittedEvents = [];
  const rootIds = ['home', 'profilePage', 'messagesPage', 'notificationsPage', 'friendsDirectoryPage', 'reelsPage'];
  const pageRoot = { home: 'home', profile: 'profilePage', messages: 'messagesPage', notifications: 'notificationsPage', friends: 'friendsDirectoryPage', reels: 'reelsPage' };
  const roots = Object.fromEntries(rootIds.map(id => {
    const attrs = new Set();
    return [id, {
      id,
      hidden: id !== (pageRoot[page] || 'home'),
      isConnected: true,
      closest() { return null; },
      hasAttribute(name) { return attrs.has(name); },
      setAttribute(name) { attrs.add(name); },
      removeAttribute(name) { attrs.delete(name); }
    }];
  }));
  const scrollingElement = { scrollLeft: 0, scrollTop: 0, scrollHeight, clientHeight: 700 };
  const document = {
    body: { dataset: { egybookActivePage: page }, scrollHeight },
    documentElement: { scrollHeight, clientHeight: 700, scrollLeft: 0, scrollTop: 0 },
    scrollingElement,
    visibilityState: 'visible',
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); },
    dispatchEvent(event) { emittedEvents.push(event); return true; },
    querySelector(selector) { return roots[selector.replace('#', '')] || null; },
    getElementById(id) { return roots[id] || null; }
  };
  const location = { pathname, hash: '' };
  const history = { state: historyState };
  const storage = new Map();
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
    getComputedStyle(element) {
      return {
        display: element.hidden ? 'none' : 'block',
        visibility: element.hasAttribute(GATE) ? 'hidden' : 'visible'
      };
    },
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
  function changePage(nextPage, { revealBefore = true, username = null } = {}) {
    if (username) history.state = { page: nextPage, username };
    Object.values(roots).forEach(root => { root.hidden = true; });
    const root = roots[pageRoot[nextPage] || 'home'];
    document.body.dataset.egybookActivePage = nextPage;
    // setPage reveals Home before announcing the new route. routeToProfile
    // announces Profile before revealing it. Exercise both real orderings.
    if (revealBefore) root.hidden = false;
    (documentListeners['egybook:primarypagechange'] || []).forEach(callback => callback({ detail: { page: nextPage } }));
    if (!revealBefore) root.hidden = false;
  }
  function tapRoute(action) {
    const target = new MockElement(action);
    fireWindow('pointerdown', { target });
    fireWindow('click', { target });
  }
  function runFrames() { let guard = 0; while (frames.length && guard++ < 30) frames.shift()(); }
  function runOneTimer() {
    const index = timers.findIndex(timer => !timer.cancelled);
    if (index < 0) return false;
    const [timer] = timers.splice(index, 1);
    timer.callback();
    return true;
  }

  return { window, document, roots, storage, documentListeners, windowListeners, emittedEvents, changePage, tapRoute, fireWindow, runFrames, runOneTimer };
}

function saved(y, x = 0) { return { x, y, savedAt: Date.now() }; }

// Home is paint-gated synchronously before the first frame after setPage reveals it.
{
  const app = createHarness();
  app.window.scrollY = 1280;
  app.document.scrollingElement.scrollTop = 1280;
  app.tapRoute('messages');
  app.changePage('messages');
  app.window.scrollTo({ top: 0 });
  app.tapRoute('page');
  app.changePage('home', { revealBefore: false });
  assert.ok(app.roots.home.hasAttribute(GATE), 'Home must be gated before its first render');
  assert.strictEqual(app.window.getComputedStyle(app.roots.home).visibility, 'hidden');
  assert.strictEqual(app.window.scrollY, 0, 'scroll must not be faked before restoration');
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 1280);
  assert.ok(!app.roots.home.hasAttribute(GATE), 'Home gate must release after scrollTo');
  assert.ok(app.emittedEvents.some(event => event.type === 'egybook:navigation-scroll-restored'));
}

// Profile route announces the change before routeToProfile removes hidden from #profilePage.
{
  const app = createHarness({
    page: 'messages',
    pathname: '/Egybook/messages',
    historyState: { page: 'messages' },
    savedRoutes: { 'profile:nour': saved(860) }
  });
  app.changePage('profile', { revealBefore: false, username: 'nour' });
  assert.ok(app.roots.profilePage.hasAttribute(GATE), 'Profile must be gated while it is still hidden');
  assert.strictEqual(app.roots.profilePage.hidden, false);
  app.runFrames();
  assert.strictEqual(app.window.scrollY, 860);
  assert.ok(!app.roots.profilePage.hasAttribute(GATE));
}

// A short initial document height keeps the destination hidden until feed/profile content grows.
{
  const app = createHarness({ scrollHeight: 1000 });
  app.window.scrollY = 900;
  app.document.scrollingElement.scrollTop = 900;
  app.tapRoute('messages');
  app.changePage('messages');
  app.window.scrollTo({ top: 0 });
  app.tapRoute('page');
  app.changePage('home');
  app.runFrames();
  assert.ok(app.roots.home.hasAttribute(GATE), 'Home remains gated while saved scroll is unreachable');
  assert.strictEqual(app.window.scrollY, 0);
  app.document.scrollingElement.scrollHeight = 2400;
  app.document.body.scrollHeight = 2400;
  assert.ok(app.runOneTimer(), 'a scheduled height retry should exist');
  assert.strictEqual(app.window.scrollY, 900);
  assert.ok(!app.roots.home.hasAttribute(GATE));
}

// Rapid navigation cancels a pending restore and releases the previous destination gate.
{
  const app = createHarness({ scrollHeight: 1000 });
  app.window.scrollY = 900;
  app.tapRoute('messages');
  app.changePage('messages');
  app.window.scrollTo({ top: 0 });
  app.tapRoute('page');
  app.changePage('home');
  app.runFrames();
  assert.ok(app.roots.home.hasAttribute(GATE));
  app.tapRoute('notifications');
  app.changePage('notifications');
  assert.ok(!app.roots.home.hasAttribute(GATE), 'cancelled Home restore must not leave a hidden page');
  assert.strictEqual(app.window.__egybookNavigationStateV2302.getSavedPosition('home').y, 900,
    'leaving a gated route must not replace the saved position with temporary zero');
}

// Scroll/touch input does not prematurely expose a gated page at document position zero.
{
  const app = createHarness({ scrollHeight: 1000 });
  app.window.scrollY = 900;
  app.tapRoute('messages');
  app.changePage('messages');
  app.window.scrollTo({ top: 0 });
  app.tapRoute('page');
  app.changePage('home');
  app.runFrames();
  app.fireWindow('touchstart', {});
  app.fireWindow('wheel', {});
  assert.ok(app.roots.home.hasAttribute(GATE), 'ordinary scroll gestures must not release a pending restoration');
  app.tapRoute('messages');
  app.changePage('messages');
  assert.ok(!app.roots.home.hasAttribute(GATE), 'a real route change must cancel and release the gate');
  assert.strictEqual(app.window.__egybookNavigationStateV2302.getSavedPosition('home').y, 900);
}

// A page with no saved non-zero offset keeps its normal reveal behavior.
{
  const app = createHarness();
  app.changePage('home');
  assert.ok(!app.roots.home.hasAttribute(GATE));
}

// The dedicated stylesheet must preserve layout while preventing any descendant paint or hit target.
assert.match(restoreCss, /#home\[data-egybook-scroll-restore-pending\]/);
assert.match(restoreCss, /#profilePage\[data-egybook-scroll-restore-pending\]/);
assert.match(restoreCss, /visibility:\s*hidden\s*!important/);
assert.match(restoreCss, /pointer-events:\s*none\s*!important/);
assert.doesNotMatch(restoreCss, /display:\s*none/);

// Guard the actual ordering observed in V230.1. setPage dispatches the
// generic pagechange event first; its listener emits primarypagechange while
// Home is still hidden. setPage then reveals Home in the same task, but the
// navigation module has deferred scrollTo across two animation frames.
const homeRouteStart = mainSource.indexOf('function setPage(page');
const homeExpose = mainSource.indexOf("$('.container').hidden = false;", homeRouteStart);
const pageChangeListener = mainSource.indexOf("document.addEventListener('egybook:pagechange'", 0);
const pageChangeDispatch = mainSource.indexOf("document.dispatchEvent(new CustomEvent('egybook:pagechange'", homeRouteStart);
assert.ok(homeRouteStart >= 0 && pageChangeListener >= 0 && pageChangeDispatch > homeRouteStart &&
  homeExpose > pageChangeDispatch && pageChangeListener < pageChangeDispatch,
  'Home receives its primary-page event before setPage reveals the container');
const profileRouteStart = mainSource.indexOf('function routeToProfile(');
const profileAnnounce = mainSource.indexOf("syncPrimaryNavigationActive('profile')", profileRouteStart);
const profileExpose = mainSource.indexOf("$('#profilePage').hidden=false", profileRouteStart);
assert.ok(profileRouteStart >= 0 && profileAnnounce > profileRouteStart && profileExpose > profileAnnounce,
  'Profile primary-page event occurs before its hidden surface is exposed');
assert.ok(indexSource.includes('egybook-navigation-restore.css?v=2302-seamless-route-restore'));
assert.ok(indexSource.includes('egybook-navigation-state.js?v=2302-seamless-route-restore'));
assert.ok(swSource.includes('egybook-navigation-restore.css?v=2302-seamless-route-restore'));
assert.ok(swSource.includes('2026-11-egybook-v237-video-resource-identity'));

console.log('PASS: Home is paint-gated before first render and restored before reveal');
console.log('PASS: Profile is paint-gated across its pre-show route event ordering');
console.log('PASS: delayed feed growth keeps destination hidden until scroll is reachable');
console.log('PASS: rapid navigation cancels stale restore and releases gate');
console.log('PASS: scroll input cannot expose Home at zero; a route change cancels safely');
console.log('PASS: zero-offset routes keep normal reveal behavior');
console.log('PASS: dedicated CSS preserves layout and suppresses paint/hit targets');
console.log('PASS: actual Home/Profile event ordering is covered; HTML and SW references are current');
