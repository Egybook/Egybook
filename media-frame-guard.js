/* EgyBook Media Frame Guard v1.0 — non-blocking first-frame readiness. */
(function (w, d) {
  'use strict';
  if (w.EgyBookMediaFrameGuard?.version === 1) return;
  const seen = new WeakSet();
  let observer = null;
  function ready(node, kind) {
    if (!node?.isConnected) return;
    node.dataset.mediaFrameReady = kind;
    node.classList.add('egy-media-frame-ready');
  }
  function watchImage(img) {
    if (img.dataset.mediaFrameGuard === '1') return;
    img.dataset.mediaFrameGuard = '1';
    const decode = () => {
      const promise = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
      promise.then(() => { if (img.naturalWidth > 0) ready(img, 'image'); });
    };
    if (img.complete && img.naturalWidth > 0) decode();
    else {
      img.addEventListener('load', decode, { once: true });
      img.addEventListener('error', () => { img.dataset.mediaFrameError = '1'; }, { once: true });
    }
  }
  function watchVideo(video) {
    if (video.dataset.mediaFrameGuard === '1') return;
    video.dataset.mediaFrameGuard = '1';
    const decoded = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        try { video.requestVideoFrameCallback(() => ready(video, 'video')); return; } catch (_) {}
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (video.readyState >= 2 && video.videoWidth > 0) ready(video, 'video');
      }));
    };
    if (video.readyState >= 2 && video.videoWidth > 0) decoded();
    video.addEventListener('loadeddata', decoded);
    video.addEventListener('canplay', decoded);
    video.addEventListener('error', () => { video.dataset.mediaFrameError = String(video.error?.code || '1'); }, { once: true });
  }
  function scan(root) {
    const scope = root?.querySelectorAll ? root : d;
    const nodes = [];
    if (scope.matches?.('img.post-image, video.post-image, #egybookVideoPlayer, #egybookVideoPoster, .evp-swipe-preview img, .evp-swipe-preview video')) nodes.push(scope);
    nodes.push(...scope.querySelectorAll('img.post-image, video.post-image, #egybookVideoPlayer, #egybookVideoPoster, .evp-swipe-preview img, .evp-swipe-preview video'));
    nodes.forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      node.tagName === 'IMG' ? watchImage(node) : watchVideo(node);
      observer?.observe(node);
    });
  }
  function init() {
    if ('IntersectionObserver' in w) observer = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting || target.tagName !== 'VIDEO') return;
        target.preload = 'auto';
        if (target.readyState === 0 && target.dataset.mediaFrameLoadRequested !== '1') {
          target.dataset.mediaFrameLoadRequested = '1';
          try { target.load(); } catch (_) {}
        }
      });
    }, { rootMargin: '420px 0px', threshold: 0.01 });
    scan(d);
    new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); })))
      .observe(d.documentElement, { childList: true, subtree: true });
    w.addEventListener('pageshow', () => scan(d), { passive: true });
  }
  w.EgyBookMediaFrameGuard = Object.freeze({ version: 1, scan });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window, document);
