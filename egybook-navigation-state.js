/* EgyBook V230.2 — Seamless Home & Profile restoration.
 * Saves the outgoing visible route before SPA handlers hide it, then restores
 * the destination after its real document scroll range is available.
 * Reels scroll/playback ownership and browser Back/Forward restoration stay
 * with their existing controllers.
 */
(() => {
  'use strict';
  if (window.__egybookNavigationStateV2302 || window.__egybookNavigationStateV2291) return;

  const STORAGE_KEY = 'egybook_navigation_scroll_v229_1';
  const STORAGE_VERSION = 1;
  const MAX_SAVED_ROUTES = 16;
  const MAX_STATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 160;
  const RESTORE_WAIT_MS = 7000;
  const RESTORE_RETRY_MS = 90;

  const ROUTE_ROOTS = {
    home: '#home',
    profile: '#profilePage',
    messages: '#messagesPage',
    notifications: '#notificationsPage',
    friends: '#friendsDirectoryPage',
    explore: '#home',
    saved: '#home',
    reels: '#reelsPage'
  };

  let routeStates = loadRouteStates();
  let activePage = normalizePage(document.body?.dataset?.egybookActivePage || inferPageFromLocation());
  let activeKey = makeRouteKey(activePage);
  let restoreSequence = 0;
  let restorePending = false;
  let restoreTimer = 0;
  let popstateActive = false;
  let popstateSaveTimer = 0;
  let scrollSaveTimer = 0;
  let saveLockUntil = 0;
  let restoreGateRoot = null;
  const RESTORE_GATE_ATTRIBUTE = 'data-egybook-scroll-restore-pending';

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
    const match = path.match(/^\/egybook\/([^/]+)\/?$/);
    if (match && !['', 'index.html'].includes(match[1])) return 'profile';
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
    } catch (_) { return {}; }
  }

  function persistRouteStates() {
    try {
      const entries = Object.entries(routeStates)
        .sort((a, b) => b[1].savedAt - a[1].savedAt)
        .slice(0, MAX_SAVED_ROUTES);
      routeStates = Object.fromEntries(entries);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, routes: routeStates }));
    } catch (_) { /* Navigation remains usable when sessionStorage is unavailable. */ }
  }

  function readDocumentScroll() {
    const root = document.scrollingElement || document.documentElement || document.body;
    const winX = Number(window.scrollX);
    const winY = Number(window.scrollY);
    const rootX = Number(root?.scrollLeft);
    const rootY = Number(root?.scrollTop);
    return {
      x: Math.max(0, Math.round(Number.isFinite(winX) && winX > 0 ? winX : (Number.isFinite(rootX) ? rootX : 0))),
      y: Math.max(0, Math.round(Number.isFinite(winY) && winY > 0 ? winY : (Number.isFinite(rootY) ? rootY : 0)))
    };
  }

  function getRouteRoot(page) {
    const selector = ROUTE_ROOTS[page] || null;
    return selector ? document.querySelector(selector) : null;
  }

  function isRouteSurfaceVisible(page) {
    const root = getRouteRoot(page);
    if (!root || !root.isConnected || root.hidden) return false;
    if (root.closest?.('[hidden]')) return false;
    try {
      const style = window.getComputedStyle?.(root);
      if (style && style.display === 'none') return false;
      // The destination is deliberately visibility-hidden while its saved
      // scroll position is being prepared. Treat that gated surface as mounted
      // and layout-ready; all other visibility:hidden states remain unavailable.
      if (style && style.visibility === 'hidden' && !root.hasAttribute(RESTORE_GATE_ATTRIBUTE)) return false;
    } catch (_) {}
    return true;
  }

  function saveRoute(key = activeKey) {
    if (!key || activePage === 'reels' || restorePending || !isRouteSurfaceVisible(activePage)) return false;
    const position = readDocumentScroll();
    routeStates[key] = { ...position, savedAt: Date.now() };
    persistRouteStates();
    return true;
  }

  function isRouteIntent(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      '[data-page], [data-action="profile"], [data-action="messages"], ' +
      '[data-action="notifications"], [data-action="directory-open-profile"], ' +
      '[data-action="reels-close"], a[href^="/Egybook/" i]'
    );
  }

  function captureBeforeNavigation(event) {
    if (!isRouteIntent(event.target)) return;
    // If Home/Profile is paint-gated, its previous saved offset remains the
    // authoritative outgoing state. Do not cancel/reveal it here and then
    // overwrite that offset with the temporary document position (usually 0).
    // The primary-page transition below will cancel and release the gate in
    // the same task that hides the outgoing route.
    if (restorePending && restoreGateRoot) return;
    if (restorePending) cancelRestore();
    saveRoute(activeKey);
  }
  window.addEventListener('pointerdown', captureBeforeNavigation, true);
  window.addEventListener('click', captureBeforeNavigation, true);

  function maxDocumentScrollY() {
    const root = document.scrollingElement || document.documentElement || document.body;
    const height = Math.max(Number(root?.scrollHeight) || 0, Number(document.body?.scrollHeight) || 0);
    const viewport = Math.max(Number(window.innerHeight) || 0, Number(root?.clientHeight) || 0);
    return Math.max(0, height - viewport);
  }

  function releaseRestoreGate() {
    if (restoreGateRoot) {
      if (typeof restoreGateRoot.removeAttribute === 'function') {
        restoreGateRoot.removeAttribute(RESTORE_GATE_ATTRIBUTE);
      }
      restoreGateRoot = null;
    }
  }

  function applyRestoreGate(page) {
    if (page !== 'home' && page !== 'profile') return;
    const root = getRouteRoot(page);
    if (!root || !root.isConnected) return;
    releaseRestoreGate();
    root.setAttribute(RESTORE_GATE_ATTRIBUTE, '');
    restoreGateRoot = root;
  }

  function cancelRestore() {
    restoreSequence++;
    restorePending = false;
    if (restoreTimer) window.clearTimeout(restoreTimer);
    restoreTimer = 0;
    // Every cancellation path (rapid route change or unavailable surface) must
    // release the visual gate so a destination can never remain hidden.
    releaseRestoreGate();
  }

  function emitScrollRestored(key, saved, appliedY) {
    document.dispatchEvent(new CustomEvent('egybook:navigation-scroll-restored', {
      detail: { page: activePage, key, x: saved.x, y: appliedY, requestedY: saved.y }
    }));
  }

  function restoreRoute(key) {
    const saved = routeStates[key];
    if (!saved || activePage === 'reels') return;
    cancelRestore();
    // Home and Profile share the document scroll position. Keep the incoming
    // surface out of the paint/compositing path until the saved offset is
    // applied, rather than showing it at zero and correcting it afterward.
    if ((activePage === 'home' || activePage === 'profile') && (saved.y > 1 || saved.x > 1)) {
      applyRestoreGate(activePage);
    }
    const sequence = restoreSequence;
    const startedAt = Date.now();
    restorePending = true;
    saveLockUntil = startedAt + RESTORE_WAIT_MS + 500;

    const attempt = () => {
      restoreTimer = 0;
      if (sequence !== restoreSequence || key !== activeKey || activePage === 'reels') {
        restorePending = false;
        return;
      }
      if (!isRouteSurfaceVisible(activePage)) {
        if (Date.now() - startedAt < RESTORE_WAIT_MS) {
          restoreTimer = window.setTimeout(attempt, RESTORE_RETRY_MS);
          return;
        }
        restorePending = false;
        releaseRestoreGate();
        return;
      }

      const maxY = maxDocumentScrollY();
      const canReachSavedPosition = maxY + 2 >= saved.y;
      const timedOut = Date.now() - startedAt >= RESTORE_WAIT_MS;
      if (!canReachSavedPosition && !timedOut) {
        // Feed/profile rows may be restored from IndexedDB or the network after
        // the destination is shown. Wait for the document to grow instead of
        // immediately clamping a valid old position back to the top.
        restoreTimer = window.setTimeout(attempt, RESTORE_RETRY_MS);
        return;
      }

      const appliedY = Math.min(saved.y, maxY);
      try { window.scrollTo({ left: saved.x, top: appliedY, behavior: 'auto' }); }
      catch (_) { window.scrollTo(saved.x, appliedY); }
      emitScrollRestored(key, saved, appliedY);
      restorePending = false;
      // scrollTo runs while the surface is still not paintable. Releasing the
      // gate afterward ensures its first visible frame is already at the
      // restored position (same task, before the next rendering opportunity).
      releaseRestoreGate();
      saveLockUntil = Date.now() + 320;
      // Keep the original requested position in storage. A short result set or
      // delayed first-page hydration must not permanently replace it with zero.
    };

    window.requestAnimationFrame(() => window.requestAnimationFrame(attempt));
  }

  function handlePrimaryPageChange(event) {
    const nextPage = normalizePage(event.detail && event.detail.page);
    const nextKey = makeRouteKey(nextPage);
    if (nextPage === activePage && nextKey === activeKey) return;

    // Several EgyBook route handlers change currentPage before they hide the
    // outgoing surface; use that pre-hide window to save programmatic routes.
    // For handlers that hide first (Messages/Notifications), the capture-phase
    // pointer/click listener above has already saved the outgoing route.
    if (isRouteSurfaceVisible(activePage)) saveRoute(activeKey);

    activePage = nextPage;
    activeKey = nextKey;
    cancelRestore();

    if (popstateActive) {
      saveLockUntil = Date.now() + 1000;
      if (popstateSaveTimer) window.clearTimeout(popstateSaveTimer);
      popstateSaveTimer = window.setTimeout(() => {
        popstateSaveTimer = 0;
        saveRoute(activeKey);
        saveLockUntil = 0;
      }, 460);
      return;
    }

    if (nextPage !== 'reels') restoreRoute(nextKey);
  }

  function onScroll() {
    if (activePage === 'reels' || restorePending || Date.now() < saveLockUntil || scrollSaveTimer) return;
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = 0;
      if (!restorePending && Date.now() >= saveLockUntil) saveRoute(activeKey);
    }, SAVE_DEBOUNCE_MS);
  }

  function markRouteRoots() {
    const home = document.getElementById('home');
    if (home && !home.hasAttribute('data-route-page')) home.setAttribute('data-route-page', '');
    const friends = document.getElementById('friendsDirectoryPage');
    if (friends && !friends.hasAttribute('data-route-page')) friends.setAttribute('data-route-page', '');
  }

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
  window.addEventListener('popstate', () => {
    saveRoute(activeKey);
    popstateActive = true;
    window.setTimeout(() => { popstateActive = false; }, 0);
    if (popstateSaveTimer) window.clearTimeout(popstateSaveTimer);
    popstateSaveTimer = window.setTimeout(() => {
      popstateSaveTimer = 0;
      saveRoute(activeKey);
      saveLockUntil = 0;
    }, 460);
  }, true);

  const navigationStateApi = Object.freeze({
    version: 'V230.2',
    saveNow: () => saveRoute(activeKey),
    getActivePage: () => activePage,
    getSavedRoutes: () => Object.keys(routeStates),
    getSavedPosition: key => routeStates[String(key || '')] || null
  });
  // Keep the legacy name as an alias because existing routing code reads it.
  window.__egybookNavigationStateV2302 = navigationStateApi;
  window.__egybookNavigationStateV2291 = navigationStateApi;

  // Refresh/reopen the same route in the same browser tab can reuse its last
  // session offset. Reels is intentionally excluded and remains Keep-Alive owned.
  if (activePage !== 'reels' && routeStates[activeKey]) restoreRoute(activeKey);
})();
