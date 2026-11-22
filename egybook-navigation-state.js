/* EgyBook V229 — Persistent page navigation state
 * Keeps each primary page's scroll position across SPA tab navigation.
 * Browser Back/Forward restoration remains owned by the existing route-scroll
 * controller in script.js; this module only fills the direct-tab-navigation gap.
 */
(() => {
  'use strict';

  if (window.__egybookNavigationStateV229) return;

  const STORAGE_KEY = 'egybook_navigation_scroll_v229';
  const STORAGE_VERSION = 1;
  const MAX_SAVED_ROUTES = 12;
  const MAX_STATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const RESTORE_LOCK_MS = 160;

  let routeStates = loadRouteStates();
  let activePage = normalizePage(document.body?.dataset?.egybookActivePage || inferPageFromLocation());
  let activeKey = makeRouteKey(activePage);
  let restoreSequence = 0;
  let restorePending = false;
  let popstateActive = false;
  let popstateSaveTimer = 0;
  let scrollSaveTimer = 0;
  let saveLockUntil = 0;

  function normalizePage(value) {
    const page = String(value || 'home').trim().toLowerCase();
    return /^[a-z0-9_-]{1,32}$/.test(page) ? page : 'home';
  }

  function inferPageFromLocation() {
    const path = String(location.pathname || '').toLowerCase();
    if (/\/messages(?:\/|$)/.test(path)) return 'messages';
    if (/\/notifications\/?$/.test(path)) return 'notifications';
    if (/\/reels\/?$/.test(path)) return 'reels';
    if (/\/friends\/?$/.test(path) || location.hash === '#friends') return 'friends';
    if (/\/saved\/?$/.test(path)) return 'saved';
    const profileMatch = path.match(/^\/egybook\/([^/]+)\/?$/);
    if (profileMatch && !['', 'index.html'].includes(profileMatch[1])) return 'profile';
    return 'home';
  }

  function makeRouteKey(page) {
    if (page === 'profile') {
      const stateUsername = history.state && typeof history.state.username === 'string'
        ? history.state.username : '';
      const match = String(location.pathname || '').match(/^\/Egybook\/([^/]+)\/?$/i);
      let username = stateUsername || (match ? match[1] : 'current');
      try { username = decodeURIComponent(username); } catch (_) {}
      username = String(username).trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'current';
      return `profile:${username}`;
    }
    return page || 'home';
  }

  function loadRouteStates() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== STORAGE_VERSION || !parsed.routes || typeof parsed.routes !== 'object') return {};
      const now = Date.now();
      const clean = {};
      Object.entries(parsed.routes).forEach(([key, value]) => {
        if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.savedAt)) return;
        if (now - value.savedAt > MAX_STATE_AGE_MS || value.x < 0 || value.y < 0) return;
        clean[key] = { x: Math.round(value.x), y: Math.round(value.y), savedAt: value.savedAt };
      });
      return clean;
    } catch (_) {
      return {};
    }
  }

  function persistRouteStates() {
    try {
      const entries = Object.entries(routeStates)
        .sort((a, b) => b[1].savedAt - a[1].savedAt)
        .slice(0, MAX_SAVED_ROUTES);
      const retained = {};
      entries.forEach(([key, value]) => { retained[key] = value; });
      routeStates = retained;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, routes: routeStates }));
    } catch (_) {
      // Navigation still works normally when sessionStorage is unavailable.
    }
  }

  function saveRoute(key = activeKey) {
    // A route can be interrupted before its saved position is restored. In that
    // window, the current zero/top position is not the route's real saved state.
    if (!key || activePage === 'reels' || restorePending) return;
    const x = Math.max(0, Number(window.scrollX) || 0);
    const y = Math.max(0, Number(window.scrollY) || 0);
    routeStates[key] = { x, y, savedAt: Date.now() };
    persistRouteStates();
  }

  function finishRestore(sequence, key) {
    if (sequence !== restoreSequence || key !== activeKey) return;
    restorePending = false;
    saveLockUntil = Date.now() + RESTORE_LOCK_MS;
    // Record the browser's final clamped position after the destination is laid out.
    window.setTimeout(() => {
      if (sequence === restoreSequence && key === activeKey) saveRoute(key);
    }, RESTORE_LOCK_MS);
  }

  function restoreRoute(key) {
    const saved = routeStates[key];
    if (!saved || activePage === 'reels') return;

    const sequence = ++restoreSequence;
    restorePending = true;
    saveLockUntil = Date.now() + 1000;

    // Two animation frames let the destination's hidden state, styles and layout settle.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (sequence !== restoreSequence || key !== activeKey || activePage === 'reels') return;
        try {
          window.scrollTo({ left: saved.x, top: saved.y, behavior: 'auto' });
        } catch (_) {
          window.scrollTo(saved.x, saved.y);
        }
        // Tell the existing Facebook-style header controller that this scroll
        // was a state restore, not a finger gesture, so it can rebase direction.
        document.dispatchEvent(new CustomEvent('egybook:navigation-scroll-restored', {
          detail: { page: activePage, x: saved.x, y: saved.y }
        }));
        finishRestore(sequence, key);
      });
    });
  }

  function handlePrimaryPageChange(event) {
    const nextPage = normalizePage(event.detail && event.detail.page);
    const nextKey = makeRouteKey(nextPage);
    if (nextPage === activePage && nextKey === activeKey) return;

    // Save the outgoing page synchronously, before route handlers reset scroll to zero.
    saveRoute(activeKey);
    activePage = nextPage;
    activeKey = nextKey;
    restoreSequence++;
    restorePending = false;

    if (popstateActive) {
      // The legacy history-entry restorer remains authoritative for Back/Forward.
      // Save its settled result shortly after it restores the browser entry.
      saveLockUntil = Date.now() + 1000;
      if (popstateSaveTimer) window.clearTimeout(popstateSaveTimer);
      popstateSaveTimer = window.setTimeout(() => {
        popstateSaveTimer = 0;
        if (!restorePending) saveRoute(activeKey);
        saveLockUntil = 0;
      }, 420);
      return;
    }

    if (nextPage !== 'reels') restoreRoute(nextKey);
  }

  function onScroll() {
    if (activePage === 'reels' || restorePending || Date.now() < saveLockUntil || scrollSaveTimer) return;
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = 0;
      if (!restorePending && Date.now() >= saveLockUntil) saveRoute(activeKey);
    }, 350);
  }

  function markRouteRoots() {
    const home = document.getElementById('home');
    if (home && !home.hasAttribute('data-route-page')) home.setAttribute('data-route-page', '');
    const friends = document.getElementById('friendsDirectoryPage');
    if (friends && !friends.hasAttribute('data-route-page')) friends.setAttribute('data-route-page', '');
  }

  // Friends directory is created lazily by script.js, so observe only body-level
  // route-root insertion rather than watching the whole feed DOM.
  markRouteRoots();
  if (window.MutationObserver && document.body) {
    const routeRootObserver = new MutationObserver(markRouteRoots);
    routeRootObserver.observe(document.body, { childList: true });
  }

  document.addEventListener('egybook:primarypagechange', handlePrimaryPageChange);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', () => saveRoute(activeKey));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveRoute(activeKey);
  });

  // Capture before route popstate handlers hide the outgoing page or reset scroll.
  window.addEventListener('popstate', () => {
    saveRoute(activeKey);
    popstateActive = true;
    window.setTimeout(() => { popstateActive = false; }, 0);
    if (popstateSaveTimer) window.clearTimeout(popstateSaveTimer);
    popstateSaveTimer = window.setTimeout(() => {
      popstateSaveTimer = 0;
      if (!restorePending) saveRoute(activeKey);
      saveLockUntil = 0;
    }, 420);
  }, true);

  window.__egybookNavigationStateV229 = Object.freeze({
    version: 'V229',
    saveNow: () => saveRoute(activeKey),
    getActivePage: () => activePage,
    getSavedRoutes: () => Object.keys(routeStates)
  });
})();
