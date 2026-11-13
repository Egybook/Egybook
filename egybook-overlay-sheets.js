/* EgyBook — drag-to-dismiss behavior for the existing sound and create sheets. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);

  function bindDrag({ modal, sheet, handle, close, threshold = 112, canStart = null }) {
    if (!modal || !sheet || !handle) return;
    let pointer = null, startY = 0, currentY = 0, startedAt = 0;
    handle.style.touchAction = 'none';
    const startTarget = event => canStart ? canStart(event) : event.target === handle || handle.contains(event.target);
    sheet.addEventListener('pointerdown', event => {
      if (!startTarget(event)) return;
      if (event.target.closest('button, a, input, textarea, select')) return;
      if (event.button !== undefined && event.button !== 0) return;
      if (pointer !== null) return;
      pointer = event.pointerId; startY = currentY = event.clientY; startedAt = performance.now();
      sheet.style.transition = 'none';
      try { sheet.setPointerCapture(pointer); } catch (_) {}
      if (event.cancelable) event.preventDefault();
    });
    sheet.addEventListener('pointermove', event => {
      if (event.pointerId !== pointer) return;
      currentY = event.clientY;
      if (event.cancelable) event.preventDefault();
      const delta = Math.max(0, currentY - startY);
      sheet.style.transform = `translate3d(0,${delta}px,0)`;
      modal.style.setProperty('--sheet-drag-backdrop', String(Math.max(.18, .72 - delta / 500)));
    });
    const finish = event => {
      if (event.pointerId !== pointer) return;
      const delta = Math.max(0, (event.clientY || currentY) - startY);
      const velocity = delta / Math.max(1, performance.now() - startedAt);
      const shouldClose = delta > threshold || (delta > 42 && velocity > .62);
      pointer = null;
      if (shouldClose) {
        sheet.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
        sheet.style.transform = 'translate3d(0,105%,0)';
        modal.style.setProperty('--sheet-drag-backdrop', '0');
        window.setTimeout(() => {
          sheet.style.transition = ''; sheet.style.transform = ''; modal.style.removeProperty('--sheet-drag-backdrop');
          close?.();
        }, 225);
      } else {
        sheet.style.transition = ''; sheet.style.transform = ''; modal.style.removeProperty('--sheet-drag-backdrop');
      }
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => sheet.addEventListener(type, finish));
  }

  const soundModal = $('#evpSoundModal');
  bindDrag({ modal: soundModal, sheet: soundModal?.querySelector('.evp-sound-sheet'), handle: soundModal?.querySelector('.evp-sound-handle'), canStart: event => !!event.target.closest('.evp-sound-handle, .evp-sound-header'), close: () => soundModal?.querySelector('[data-action="evp-sound-close"]')?.click() });

  // Keep one same-URL history entry while the sheet is open. The application-
  // level popstate controller in script.js is the sole owner of closing it.
  if (soundModal) {
    let soundHistoryEntry = false;
    const syncSoundHistory = () => {
      const open = soundModal.classList.contains('open');
      if (open && !soundHistoryEntry) {
        try {
          history.pushState({ ...(history.state || {}), egybookOverlay: 'evp-sound-page' }, '', location.href);
          soundModal.dataset.overlayHistory = 'evp-sound-page';
          soundHistoryEntry = true;
        } catch (_) {}
      } else if (!open) soundHistoryEntry = false;
    };
    new MutationObserver(syncSoundHistory).observe(soundModal, { attributes: true, attributeFilter: ['class'] });
    syncSoundHistory();
  }
  // Keeping a second popstate listener here caused duplicate close calls and
  // stale history entries; script.js handles Back and close-button cleanup.
  const soundSheet = soundModal?.querySelector('.evp-sound-sheet');
  if (soundSheet) {
    bindDrag({
      modal: soundModal,
      sheet: soundSheet,
      handle: soundModal.querySelector('.evp-sound-handle'),
      threshold: 88,
      canStart: event => {
        const interactive = event.target.closest('button, a, input, textarea, select, .evp-sound-post-card');
        if (interactive) return false;
        return !!event.target.closest('.evp-sound-handle, .evp-sound-header') || soundSheet.scrollTop <= 0;
      },
      close: () => soundModal?.querySelector('[data-action="evp-sound-close"]')?.click()
    });
  }

  const createModal = $('#composerMenuModal');
  const createSheet = createModal?.querySelector('.composer-menu-box');
  const createHandle = createModal?.querySelector('.composer-menu-handle');
  const closeCreate = () => createModal?.querySelector('.composer-cancel')?.click();
  bindDrag({ modal: createModal, sheet: createSheet, handle: createHandle, close: closeCreate });

  if (createModal) {
    let historyEntry = false, ignorePop = false;
    const observer = new MutationObserver(() => {
      const open = createModal.classList.contains('open');
      if (open && !historyEntry) {
        try { history.pushState({ ...(history.state || {}), egybookCreateSheet: true }, '', location.href); historyEntry = true; } catch (_) {}
      } else if (!open && historyEntry) {
        historyEntry = false;
        if (history.state?.egybookCreateSheet) { ignorePop = true; history.back(); }
      }
    });
    observer.observe(createModal, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('popstate', event => {
      if (ignorePop) { ignorePop = false; event.stopImmediatePropagation(); return; }
      if (!historyEntry || !createModal.classList.contains('open')) return;
      historyEntry = false; closeCreate(); event.stopImmediatePropagation(); event.preventDefault?.();
    }, true);
  }
})();
