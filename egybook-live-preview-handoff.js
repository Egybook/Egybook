/* EgyBook V234 — Live Preview Handoff.
 * Moves the already-decoded feed video element into the existing unified
 * player stage while the canonical player catches up. The exact same HTMLVideoElement
 * is preserved; no screenshot, poster, SVG, backdrop, or replacement media is created.
 * Once the canonical player presents its matching frame, the feed element is
 * restored to its original DOM position. This module never assigns a media URL.
 */
(() => {
  'use strict';

  if (window.EgyBookLivePreviewHandoffV234?.version === '234.0') return;

  let sequence = 0;
  const activeByVideo = new WeakMap();

  function promote(video, host) {
    if (!video || video.tagName !== 'VIDEO' || !video.isConnected || !host?.appendChild) return null;
    if (Number(video.readyState) < 2 || !Number(video.videoWidth) || !Number(video.videoHeight) || video.error) return null;

    const existing = activeByVideo.get(video);
    if (existing && !existing.restored) restore(existing);

    const parent = video.parentNode;
    if (!parent?.insertBefore) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'evp-live-preview-handoff';
    wrapper.dataset.handoffId = String(++sequence);
    wrapper.setAttribute('aria-hidden', 'true');

    const lease = {
      id: sequence,
      video,
      wrapper,
      parent,
      nextSibling: video.nextSibling,
      originalClass: video.getAttribute('class'),
      restored: false,
      completed: false
    };

    try {
      host.appendChild(wrapper);
      wrapper.appendChild(video);
      video.classList.add('evp-live-preview-handoff-video');
      activeByVideo.set(video, lease);
      return lease;
    } catch (_) {
      try {
        if (parent.isConnected || parent) parent.insertBefore(video, lease.nextSibling?.parentNode === parent ? lease.nextSibling : null);
      } catch (_) {}
      try { wrapper.remove(); } catch (_) {}
      return null;
    }
  }

  function restore(lease) {
    if (!lease || lease.restored) return false;
    const { video, wrapper, parent, nextSibling, originalClass } = lease;
    if (!video || !parent?.insertBefore) return false;
    try {
      parent.insertBefore(video, nextSibling?.parentNode === parent ? nextSibling : null);
      if (originalClass === null) video.removeAttribute('class');
      else video.setAttribute('class', originalClass);
      wrapper?.remove?.();
      lease.restored = true;
      if (activeByVideo.get(video) === lease) activeByVideo.delete(video);
      return true;
    } catch (_) {
      return false;
    }
  }

  function complete(lease, options = {}) {
    if (!lease || lease.restored || !lease.video?.isConnected) return false;
    const video = lease.video;
    try { video.pause(); } catch (_) {}
    const time = Number(options.time);
    if (Number.isFinite(time) && time >= 0 && Math.abs((Number(video.currentTime) || 0) - time) > 0.12) {
      try { video.currentTime = time; } catch (_) {}
    }
    lease.completed = true;
    return restore(lease);
  }

  window.EgyBookLivePreviewHandoffV234 = Object.freeze({
    version: '234.0',
    promote,
    restore,
    complete,
    isActive(lease) { return !!lease && !lease.restored && activeByVideo.get(lease.video) === lease; }
  });
})();
