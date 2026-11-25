/* EgyBook Pull-to-Refresh Module v244
 * Owns the Home/Profile pull-to-refresh gesture and injects app data actions
 * from the core scope. No app state is copied or duplicated here.
 */
(() => {
  'use strict';
  if (window.EgyBookPullRefresh?.version === 1) return;

  function init(context = {}) {
    if (window.__egybookUnifiedPullRefreshInstalled) return false;
    const {
      getCurrentPage, getCurrentUser, getSupabase, postsList, restorePosts,
      loadCloudPostStats, getPublicProfileId, getPublicProfileIsOwn,
      restoreCloudProfile, renderProfilePosts, loadProfileFriends,
      updateViewedProfilePresence, showToast
    } = context;
    const required = [getCurrentPage, getCurrentUser, getSupabase, postsList, restorePosts, showToast];
    if (!required.every(value => typeof value === 'function' || value && typeof value === 'object')) {
      console.warn('EgyBook Pull-to-Refresh: required app context is incomplete.');
      return false;
    }
    window.__egybookUnifiedPullRefreshInstalled = true;


    const THRESHOLD = 76;
    const MAX_PULL = 118;
    const IGNORE_SELECTOR = 'input, textarea, select, video, audio, [contenteditable="true"], .modal.open, .modal:not([hidden]), .stories, .top-navigation, .profile-shortcuts, .profile-stories';
    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let pulling = false;
    let refreshing = false;
    let activePage = null;
    let indicator = null;
    let refreshToken = 0;

    function getActivePage() {
      if (getCurrentPage() === 'profile') {
        const profile = document.getElementById('profilePage');
        if (profile && !profile.hidden && getComputedStyle(profile).display !== 'none') return 'profile';
      }
      if (getCurrentPage() === 'home') {
        const home = document.getElementById('home');
        if (home && !home.hidden && getComputedStyle(home).display !== 'none') return 'home';
      }
      return null;
    }

    function pageSurface(page) {
      return page === 'profile' ? document.getElementById('profilePage') : document.getElementById('home');
    }

    function isAtDocumentTop() {
      const y = Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
      return y <= 2;
    }

    function getIndicator(page) {
      if (indicator && indicator.isConnected) {
        indicator.dataset.page = page;
        const label = indicator.querySelector('.profile-pull-refresh-label');
        if (label) label.textContent = page === 'profile' ? 'اسحب لتحديث الملف الشخصي' : 'اسحب لتحديث الصفحة الرئيسية';
        const icon = indicator.querySelector('.home-pull-refresh-icon, .profile-pull-refresh-user');
        if (icon) {
          if (page === 'profile') {
            icon.className = 'profile-pull-refresh-user';
            icon.textContent = '♙';
          } else {
            icon.className = 'home-pull-refresh-icon';
            icon.textContent = '⌂';
          }
        }
        indicator.querySelector('.profile-pull-refresh-avatar')?.classList.toggle('home-pull-refresh-avatar', page === 'home');
        return indicator;
      }
      indicator = document.createElement('div');
      indicator.id = 'egybookPullRefreshIndicator';
      indicator.className = 'profile-pull-refresh-indicator';
      indicator.dataset.page = page;
      indicator.setAttribute('aria-live', 'polite');
      indicator.innerHTML = '<span class="profile-pull-refresh-avatar" aria-hidden="true"><span class="profile-pull-refresh-ring"></span><span class="profile-pull-refresh-user">♙</span></span><span class="profile-pull-refresh-label">اسحب لتحديث الملف الشخصي</span>';
      document.body.appendChild(indicator);
      return getIndicator(page);
    }

    function setIndicator(page, distance, state = 'pulling') {
      const node = getIndicator(page);
      const progress = Math.min(1, distance / THRESHOLD);
      node.style.setProperty('--pull-progress', String(progress));
      node.style.setProperty('--pull-offset', `${Math.max(-74, -74 + Math.min(distance, MAX_PULL) * .72)}px`);
      node.classList.remove('is-refreshing', 'is-success', 'is-error');
      node.classList.toggle('is-pulling', state === 'pulling');
      const label = node.querySelector('.profile-pull-refresh-label');
      if (label) {
        if (state === 'pulling') label.textContent = distance >= THRESHOLD ? 'اترك للتحديث' : (page === 'profile' ? 'اسحب لتحديث الملف الشخصي' : 'اسحب لتحديث الصفحة الرئيسية');
        if (state === 'refreshing') label.textContent = page === 'profile' ? 'جاري تحديث الملف الشخصي' : 'جاري تحديث الصفحة الرئيسية';
      }
      return node;
    }

    function resetIndicator() {
      if (!indicator) return;
      indicator.classList.remove('is-pulling', 'is-refreshing', 'is-success', 'is-error');
      indicator.style.setProperty('--pull-progress', '0');
      indicator.style.setProperty('--pull-offset', '-74px');
      const label = indicator.querySelector('.profile-pull-refresh-label');
      if (label) label.textContent = indicator.dataset.page === 'profile' ? 'اسحب لتحديث الملف الشخصي' : 'اسحب لتحديث الصفحة الرئيسية';
    }

    async function refreshHomeData() {
      if (!getCurrentUser() || !getSupabase()) throw new Error('يلزم تسجيل الدخول لتحديث الخلاصة.');
      const refreshed = await restorePosts({force:true});
      if (refreshed !== true) throw new Error('لم يكتمل تحديث المنشورات. حاول مرة أخرى.');
      // Refresh the visible top-post summaries only. This updates the counts and
      // current user's reactions without launching a stats request for every card.
      const topPosts = [...postsList.querySelectorAll('.post[data-cloud-post="true"]')].slice(0, 2);
      for (const post of topPosts) {
        if (post.isConnected && typeof loadCloudPostStats === 'function') await loadCloudPostStats(post);
      }
    }

    async function refreshProfileData() {
      if (!getCurrentUser() || !getSupabase()) throw new Error('يلزم تسجيل الدخول لتحديث الملف الشخصي.');
      const viewedId = getPublicProfileId() || (getPublicProfileIsOwn() ? getCurrentUser().id : null);
      if (getPublicProfileIsOwn() || viewedId === getCurrentUser().id) {
        await restoreCloudProfile();
      } else {
        if (typeof renderProfilePosts === 'function') await renderProfilePosts();
        if (viewedId && typeof loadProfileFriends === 'function') await loadProfileFriends(viewedId);
        if (typeof updateViewedProfilePresence === 'function') updateViewedProfilePresence();
      }
      // restoreCloudProfile already refreshes the signed-in profile's posts;
      // public profiles are refreshed in the alternate branch above.
    }

    document.addEventListener('touchstart', event => {
      if (refreshing || event.touches.length !== 1 || document.body.classList.contains('sidebar-open')) {
        pulling = false;
        return;
      }
      const page = getActivePage();
      const surface = pageSurface(page);
      const target = event.target instanceof Element ? event.target : null;
      if (!page || !surface || !target || !surface.contains(target) || !isAtDocumentTop() || target.closest(IGNORE_SELECTOR)) {
        pulling = false;
        return;
      }
      startY = lastY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      activePage = page;
      pulling = true;
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', event => {
      if (!pulling || refreshing || event.touches.length !== 1) return;
      if (getActivePage() !== activePage || !isAtDocumentTop()) {
        pulling = false;
        resetIndicator();
        return;
      }
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      lastY = touch.clientY;
      if (dy <= 0 || Math.abs(dx) > Math.max(10, Math.abs(dy) * .8)) {
        if (Math.abs(dx) > 18) pulling = false;
        return;
      }
      // Keep touchmove passive so native scrolling stays on the compositor thread.
      // The page-level overscroll policy already disables browser pull-to-refresh.
      setIndicator(activePage, dy, 'pulling');
    }, { passive: true, capture: true });

    document.addEventListener('touchend', async event => {
      if (!pulling) return;
      pulling = false;
      const page = activePage;
      activePage = null;
      const finalY = event.changedTouches?.[0]?.clientY ?? lastY;
      const distance = finalY - startY;
      if (refreshing || !page || getActivePage() !== page || !isAtDocumentTop() || distance < THRESHOLD) {
        resetIndicator();
        return;
      }

      refreshing = true;
      const token = ++refreshToken;
      const node = setIndicator(page, THRESHOLD, 'refreshing');
      node.classList.remove('is-pulling');
      node.classList.add('is-refreshing');
      node.style.setProperty('--pull-offset', '12px');
      try {
        if (page === 'home') await refreshHomeData();
        else await refreshProfileData();
        if (token !== refreshToken) return;
        node.classList.remove('is-refreshing');
        node.classList.add('is-success');
        const label = node.querySelector('.profile-pull-refresh-label');
        if (label) label.textContent = 'تم التحديث';
      } catch (error) {
        console.warn('EgyBook pull-to-refresh failed:', error);
        if (token !== refreshToken) return;
        node.classList.remove('is-refreshing');
        node.classList.add('is-error');
        const label = node.querySelector('.profile-pull-refresh-label');
        if (label) label.textContent = 'تعذر التحديث';
        showToast(error?.message || 'تعذر تحديث الصفحة. حاول مرة أخرى.');
      } finally {
        window.setTimeout(() => {
          if (token !== refreshToken) return;
          refreshing = false;
          resetIndicator();
        }, 650);
      }
    }, { passive: true, capture: true });

    document.addEventListener('touchcancel', () => {
      pulling = false;
      activePage = null;
      if (!refreshing) resetIndicator();
    }, { passive: true, capture: true });

    // `none` (not `contain`) disables Chrome's native pull-to-refresh at the
    // document boundary; the in-app controller above owns the gesture instead.
    document.documentElement.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehaviorY = 'none';

    return true;
  }

  window.EgyBookPullRefresh = Object.freeze({ version: 1, init });
})();
