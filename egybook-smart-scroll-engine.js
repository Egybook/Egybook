/* EgyBook Smart Scroll Engine V2
 * Scroll-linked top and bottom navigation motion for Home/Profile.
 * Both bars follow the same scroll delta. The bottom dock's travel distance
 * includes overflowing children (notably the raised + button), so it leaves
 * the viewport completely. No CSS transition is allowed on `translate` while
 * the finger is driving the motion; otherwise the bar continually chases the
 * finger and appears to jump.
 */
(() => {
  'use strict';
  if (window.__egybookSmartScrollEngineV2) return;
  window.__egybookSmartScrollEngineV2 = true;

  const header = document.querySelector('.topbar');
  const nav = document.querySelector('.bottom-navigation');
  if (!header || !nav) return;

  const bars = [
    { el: header, direction: -1, progress: 0, travel: 1 },
    { el: nav, direction: 1, progress: 0, travel: 1, isDock: true }
  ];

  let lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  let rafId = 0;
  let measureRaf = 0;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  function setOffset(bar) {
    const offset = bar.direction * bar.travel * bar.progress;
    bar.el.style.setProperty('translate', `0 ${offset.toFixed(2)}px`, 'important');
    bar.el.setAttribute('data-scroll-progress', bar.progress.toFixed(3));
    bar.el.classList.toggle('nav-scroll-hidden', bar.isDock && bar.progress >= 0.985);
    bar.el.style.pointerEvents = bar.progress >= 0.985 ? 'none' : '';
  }

  function measure() {
    measureRaf = 0;
    bars.forEach(bar => {
      // Measure in the original position, independent of the current scroll offset.
      const oldTranslate = bar.el.style.getPropertyValue('translate');
      const oldPriority = bar.el.style.getPropertyPriority('translate');
      bar.el.style.setProperty('translate', '0 0', 'important');
      const rect = bar.el.getBoundingClientRect();
      if (bar.isDock) {
        let visualTop = rect.top;
        // The create (+) button intentionally protrudes above the dock.
        // Include every visible child in the visual bounds before moving the dock.
        for (const child of bar.el.querySelectorAll('*')) {
          const childRect = child.getBoundingClientRect();
          if (childRect.width && childRect.height) visualTop = Math.min(visualTop, childRect.top);
        }
        bar.travel = Math.max(rect.height, window.innerHeight - visualTop + 8);
      } else {
        bar.travel = Math.max(1, rect.height + 2);
      }
      if (oldTranslate) bar.el.style.setProperty('translate', oldTranslate, oldPriority);
      else bar.el.style.removeProperty('translate');
      setOffset(bar);
    });
  }

  function applyAll() { bars.forEach(setOffset); }

  function forceShow() {
    bars.forEach(bar => { bar.progress = 0; });
    applyAll();
  }

  function shouldForceShow() {
    const active = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || '') || !!active?.isContentEditable;
    const overlay = !!document.querySelector(
      '.modal.open,.modal.visible,#postViewer:not([hidden]),#imageViewer:not([hidden]),.egy-sidebar.is-open,.profile-menu-drawer.is-open'
    );
    return typing || overlay || (window.scrollY || 0) < 48;
  }

  function update() {
    rafId = 0;
    const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    const delta = y - lastY;
    lastY = y;

    if (shouldForceShow()) {
      forceShow();
      return;
    }
    if (Math.abs(delta) < 0.15) return;

    // Scroll down hides both bars; scroll up reveals both. Motion is 1:1
    // with actual scroll distance and is applied once per animation frame.
    const direction = delta > 0 ? 1 : -1;
    const distance = Math.abs(delta);
    bars.forEach(bar => {
      bar.progress = clamp(bar.progress + direction * distance / bar.travel);
    });
    applyAll();
  }

  function onScroll() {
    if (!rafId) rafId = requestAnimationFrame(update);
  }
  function scheduleMeasure() {
    if (!measureRaf) measureRaf = requestAnimationFrame(measure);
  }

  // Keep the scroll-linked property immediate. A 220–280ms CSS transition on
  // every scroll frame causes the nav to lag, catch up, and visibly hop.
  bars.forEach(bar => {
    bar.el.style.setProperty('transition-property', 'transform, opacity, background-color, color, border-color', 'important');
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('focusin', event => {
    if (event.target.matches('input,textarea,select,[contenteditable="true"]')) forceShow();
  });
  window.addEventListener('pageshow', () => {
    lastY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    forceShow();
    scheduleMeasure();
  }, { passive: true });
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  window.addEventListener('orientationchange', scheduleMeasure, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleMeasure, { passive: true });

  measure();
  applyAll();
})();
