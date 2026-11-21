/* Global message toast: independent of the hidden Messages route. */
(() => {
  'use strict';
  if (window.__egybookLiveEventsUIReady) return;
  window.__egybookLiveEventsUIReady = true;
  let hideTimer = 0;
  const seen = new Set();
  function ensureToast() {
    let toast = document.getElementById('egybookLiveMessageToast');
    if (toast) return toast;
    toast = document.createElement('button');
    toast.type = 'button';
    toast.id = 'egybookLiveMessageToast';
    toast.className = 'egybook-live-message-toast';
    toast.hidden = true;
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-label', 'رسالة جديدة');
    toast.innerHTML = '<span class="egybook-live-message-icon" aria-hidden="true">✉</span><span class="egybook-live-message-copy"><strong>رسالة جديدة</strong><span class="egybook-live-message-body"></span></span><span class="egybook-live-message-close" aria-hidden="true">×</span>';
    toast.addEventListener('click', () => {
      const peerId = toast.dataset.peerId;
      toast.classList.remove('is-visible');
      clearTimeout(hideTimer);
      setTimeout(() => { toast.hidden = true; }, 180);
      if (peerId) window.__egybookLiveEventsBridge?.openMessage?.(peerId);
    });
    document.body.append(toast);
    return toast;
  }
  function show(event) {
    const detail = event.detail || {};
    const row = detail.row || {};
    if (detail.threadOpen || !row.id || document.visibilityState === 'hidden') return;
    const id = String(row.id);
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 150) seen.clear();
    const toast = ensureToast();
    toast.dataset.peerId = String(row.sender_id || '');
    toast.querySelector('.egybook-live-message-body').textContent = String(row.body || 'أرسل إليك رسالة').slice(0, 180);
    toast.hidden = false;
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => { if (!toast.classList.contains('is-visible')) toast.hidden = true; }, 220);
    }, 6200);
  }
  window.addEventListener('egybook:show-message-toast', show);
})();
