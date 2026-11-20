/* EgyBook Page Navigation Engine — coordinated, lightweight surface transitions. */
(() => {
  'use strict';
  if (window.EgyBookPageNavigationEngine?.version === 1) return;

  const surfaces = {
    home: '.container',
    friends: '.container',
    explore: '.container',
    saved: '.container',
    reels: '#reelsPage',
    profile: '#profilePage',
    messages: '#messagesPage',
    notifications: '#notificationsPage',
    'friends-directory': '#friendsDirectoryPage',
    memez: '#memezPage'
  };
  let lastPage = '';
  let activeAnimation = null;

  function animateDestination(page) {
    const selector = surfaces[page];
    if (!selector) return;
    const surface = document.querySelector(selector);
    if (!surface || surface.hidden || !surface.isConnected) return;

    if (activeAnimation) {
      try { activeAnimation.cancel(); } catch (_) {}
      activeAnimation = null;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    // A very small entrance offset gives the familiar Facebook-like page
    // handoff without changing layout, fixed positioning, or scroll geometry.
    try {
      activeAnimation = surface.animate(
        [
          { opacity: 0.94, transform: 'translate3d(0, 7px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ],
        { duration: 190, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'none' }
      );
      activeAnimation.onfinish = () => { activeAnimation = null; };
      activeAnimation.oncancel = () => { activeAnimation = null; };
    } catch (_) {
      surface.style.opacity = '';
      surface.style.transform = '';
    }
  }

  document.addEventListener('egybook:pagechange', event => {
    const page = String(event.detail?.page || '');
    if (!page) return;
    lastPage = page;
    document.documentElement.dataset.egybookPage = page;
    requestAnimationFrame(() => animateDestination(page));
  });

  window.EgyBookPageNavigationEngine = Object.freeze({
    version: 1,
    getCurrentPage: () => lastPage
  });
})();
