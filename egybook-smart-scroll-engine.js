/* EgyBook Smart Scroll Engine
 * Scroll-linked chrome for Home/Profile only.
 * The bars keep their original layout coordinates; only the independent CSS
 * translate property moves them out of view. Progress follows native scroll
 * deltas instead of waiting for a threshold and running a timed hide animation.
 */
(() => {
  'use strict';
  if (window.__egybookSmartScrollEngineV1) return;
  window.__egybookSmartScrollEngineV1 = true;

  const header = document.querySelector('.topbar');
  const nav = document.querySelector('.bottom-navigation');
  if (!header || !nav) return;

  const bars = [
    { el: header, direction: -1, progress: 0, height: 0 },
    { el: nav, direction: 1, progress: 0, height: 0 }
  ];

  let lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  let rafId = 0;
  let lastTouchTime = 0;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const measure = () => {
    bars.forEach(bar => {
      bar.height = Math.max(1, bar.el.getBoundingClientRect().height || bar.el.offsetHeight || 1);
      bar.el.style.willChange = 'translate';
      bar.el.style.transition = 'none';
      bar.el.style.translate = `0 ${bar.direction * bar.height * bar.progress}px`;
    });
  };

  const apply = () => {
    bars.forEach(bar => {
      const offset = bar.direction * bar.height * bar.progress;
      // Keep existing transform (including bottom-nav horizontal centering) untouched.
      bar.el.style.translate = `0 ${offset.toFixed(2)}px`;
      bar.el.style.pointerEvents = bar.progress >= 0.985 ? 'none' : '';
      bar.el.setAttribute('data-scroll-progress', bar.progress.toFixed(3));
    });
  };

  const forceShow = () => {
    bars.forEach(bar => { bar.progress = 0; });
    apply();
  };

  const shouldForceShow = () => {
    const active = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || '') || !!active?.isContentEditable;
    const overlay = !!document.querySelector(
      '.modal.open,.modal.visible,#postViewer:not([hidden]),#imageViewer:not([hidden]),.egy-sidebar.is-open,.profile-menu-drawer.is-open'
    );
    return typing || overlay || (window.scrollY || 0) < 48;
  };

  const update = () => {
    rafId = 0;
    const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    const delta = y - lastY;
    lastY = y;

    if (shouldForceShow()) {
      forceShow();
      return;
    }
    if (Math.abs(delta) < 0.25) return;

    // Scrolling down hides; scrolling up reveals. The same physical scroll
    // distance drives both bars, so their motion remains synchronized.
    const travel = Math.abs(delta);
    bars.forEach(bar => {
      bar.progress = clamp(bar.progress + (delta > 0 ? 1 : -1) * travel / bar.height);
    });
    apply();
  };

  const onScroll = () => {
    if (!rafId) rafId = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('focusin', event => {
    if (event.target.matches('input,textarea,select,[contenteditable="true"]')) forceShow();
  });
  window.addEventListener('pageshow', () => {
    lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    forceShow();
    measure();
  }, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('orientationchange', measure, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', measure, { passive: true });

  measure();
  apply();
})();
