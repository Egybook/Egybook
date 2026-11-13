/* EgyBook — reliable bottom-sheet dismissal for sound and create sheets. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  function bindDrag({ modal, sheet, handle, close, threshold = 96, canStart = null }) {
    if (!modal || !sheet || !handle || sheet.dataset.dragBound === '1') return;
    sheet.dataset.dragBound = '1';

    let pointerId = null;
    let startY = 0;
    let lastY = 0;
    let startedAt = 0;
    let dragging = false;

    const reset = () => {
      pointerId = null;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      modal.style.removeProperty('--sheet-drag-backdrop');
    };

    const onDown = event => {
      if (!modal.classList.contains('open')) return;
      if (pointerId !== null) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const allowed = canStart ? canStart(event) : handle.contains(event.target);
      if (!allowed) return;
      pointerId = event.pointerId;
      startY = lastY = event.clientY;
      startedAt = performance.now();
      dragging = true;
      sheet.style.transition = 'none';
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      if (event.cancelable) event.preventDefault();
    };

    const onMove = event => {
      if (event.pointerId !== pointerId || !dragging) return;
      lastY = event.clientY;
      const delta = Math.max(0, lastY - startY);
      sheet.style.transform = `translate3d(0,${delta}px,0)`;
      modal.style.setProperty('--sheet-drag-backdrop', String(Math.max(.12, .68 - delta / 480)));
      if (event.cancelable) event.preventDefault();
    };

    const onUp = event => {
      if (event.pointerId !== pointerId || !dragging) return;
      const endY = Number.isFinite(event.clientY) ? event.clientY : lastY;
      const delta = Math.max(0, endY - startY);
      const elapsed = Math.max(1, performance.now() - startedAt);
      const velocity = delta / elapsed;
      const shouldClose = delta >= threshold || (delta >= 38 && velocity >= .55);
      pointerId = null;
      dragging = false;

      if (!shouldClose) {
        reset();
        return;
      }

      sheet.style.transition = 'transform 190ms cubic-bezier(.2,.8,.2,1)';
      sheet.style.transform = 'translate3d(0,110%,0)';
      modal.style.setProperty('--sheet-drag-backdrop', '0');
      window.setTimeout(() => {
        // Let the application's single closeModal controller perform all
        // scroll-lock, history, video-loop and accessibility cleanup.
        reset();
        if (modal.classList.contains('open')) close?.();
      }, 205);
    };

    const onCancel = event => {
      if (event.pointerId === pointerId) reset();
    };

    sheet.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel, { passive: true });
    // Do not treat lostpointercapture as a successful release: browsers may
    // emit it during normal capture handoff, which previously wedged the sheet.
  }

  const soundModal = $('#evpSoundModal');
  const soundSheet = soundModal?.querySelector('.evp-sound-sheet');
  const soundClose = () => soundModal?.querySelector('[data-action="evp-sound-close"]')?.click();

  if (soundModal && soundSheet) {
    bindDrag({
      modal: soundModal,
      sheet: soundSheet,
      handle: soundModal.querySelector('.evp-sound-handle'),
      threshold: 88,
      canStart: event => {
        if (event.target.closest('button, a, input, textarea, select, .evp-sound-post-card')) return false;
        const onHeader = !!event.target.closest('.evp-sound-handle, .evp-sound-header');
        // Allow a downward gesture from the sheet's top edge/content only
        // when its own scroll position is at the top.
        return onHeader || soundSheet.scrollTop <= 0;
      },
      close: soundClose
    });

    // Explicitly bind the visible close control as a fallback while routing
    // through the app's existing delegated closeModal action.
    const closeButton = soundModal.querySelector('[data-action="evp-sound-close"]');
    if (closeButton && closeButton.dataset.soundCloseBound !== '1') {
      closeButton.dataset.soundCloseBound = '1';
      closeButton.addEventListener('click', () => {
        // The document-level action handler owns actual modal cleanup.
        // This listener intentionally does not stop propagation.
      });
    }

    // The main script owns Back handling. This observer adds exactly one
    // history marker while open; it never registers a competing popstate.
    let historyEntry = false;
    const syncHistory = () => {
      const open = soundModal.classList.contains('open');
      if (open && !historyEntry) {
        try {
          history.pushState({ ...(history.state || {}), egybookOverlay: 'evp-sound-page' }, '', location.href);
          soundModal.dataset.overlayHistory = 'evp-sound-page';
          historyEntry = true;
        } catch (_) {}
      } else if (!open) {
        historyEntry = false;
      }
    };
    new MutationObserver(syncHistory).observe(soundModal, { attributes: true, attributeFilter: ['class'] });
    syncHistory();
  }

  const createModal = $('#composerMenuModal');
  const createSheet = createModal?.querySelector('.composer-menu-box');
  const createHandle = createModal?.querySelector('.composer-menu-handle');
  const closeCreate = () => createModal?.querySelector('.composer-cancel')?.click();
  bindDrag({ modal: createModal, sheet: createSheet, handle: createHandle, close: closeCreate });

  if (createModal) {
    let historyEntry = false;
    let ignorePop = false;
    const observer = new MutationObserver(() => {
      const open = createModal.classList.contains('open');
      if (open && !historyEntry) {
        try {
          history.pushState({ ...(history.state || {}), egybookCreateSheet: true }, '', location.href);
          historyEntry = true;
        } catch (_) {}
      } else if (!open && historyEntry) {
        historyEntry = false;
        if (history.state?.egybookCreateSheet) {
          ignorePop = true;
          history.back();
        }
      }
    });
    observer.observe(createModal, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('popstate', event => {
      if (ignorePop) { ignorePop = false; event.stopImmediatePropagation(); return; }
      if (!historyEntry || !createModal.classList.contains('open')) return;
      historyEntry = false;
      closeCreate();
      event.stopImmediatePropagation();
      event.preventDefault?.();
    }, true);
  }
})();
