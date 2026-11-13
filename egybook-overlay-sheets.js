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
      dragging = false;
      sheet.style.transition = '';
      // Wait for a clear downward movement before capturing/preventing default.
      // This preserves taps on the header and native scrolling inside the sheet.
    };

    const onMove = event => {
      if (event.pointerId !== pointerId) return;
      lastY = event.clientY;
      const rawDelta = lastY - startY;
      if (!dragging) {
        if (Math.abs(rawDelta) < 8) return;
        if (rawDelta < 0) { pointerId = null; return; }
        dragging = true;
        sheet.style.transition = 'none';
        try { sheet.setPointerCapture(event.pointerId); } catch (_) {}
      }
      const delta = Math.max(0, rawDelta);
      sheet.style.transform = `translate3d(0,${delta}px,0)`;
      modal.style.setProperty('--sheet-drag-backdrop', String(Math.max(.12, .68 - delta / 480)));
      if (event.cancelable) event.preventDefault();
    };

    const onUp = event => {
      if (event.pointerId !== pointerId) return;
      if (!dragging) { reset(); return; }
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
    const onLostCapture = event => {
      if (event.pointerId === pointerId && dragging) reset();
    };

    sheet.addEventListener('pointerdown', onDown, { passive: false });
    sheet.addEventListener('lostpointercapture', onLostCapture, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel, { passive: true });
    // If the browser revokes capture unexpectedly, reset the temporary drag state.
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
        // Keep drag-to-dismiss on the grip/header only so the content area can
        // use native touch scrolling without being intercepted.
        return !!event.target.closest('.evp-sound-handle, .evp-sound-header');
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
