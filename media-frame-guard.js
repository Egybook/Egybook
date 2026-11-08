/* EgyBook Media Frame Guard v2.1 — source-aware first-frame readiness. */
(function (w, d) {
  'use strict';
  if (w.EgyBookMediaFrameGuard?.version === 2) return;
  const states = new WeakMap();
  let observer = null;

  function sourceKey(node) {
    if (node.tagName === 'IMG') {
      return [node.getAttribute('src') || '', node.getAttribute('srcset') || '', node.getAttribute('sizes') || ''].join('|');
    }
    return [node.getAttribute('src') || '', node.getAttribute('poster') || '',
      ...Array.from(node.querySelectorAll('source')).map(source => source.getAttribute('src') || '')].join('|');
  }
  function markReady(node, kind, key) {
    if (!node.isConnected || states.get(node)?.key !== key) return;
    node.dataset.mediaFrameReady = kind;
    delete node.dataset.mediaFrameError;
    node.classList.remove('egy-media-frame-error');
    node.classList.add('egy-media-frame-ready');
  }
  function markError(node, key, detail) {
    if (states.get(node)?.key !== key) return;
    delete node.dataset.mediaFrameReady;
    node.dataset.mediaFrameError = String(detail || 'load');
    node.classList.remove('egy-media-frame-ready');
    node.classList.add('egy-media-frame-error');
  }
  function watch(node) {
    if (!node || !['IMG', 'VIDEO'].includes(node.tagName)) return;
    const key = sourceKey(node);
    observer?.observe(node);
    const old = states.get(node);
    if (old?.key === key) return;
    old?.controller?.abort?.();
    const controller = new AbortController();
    states.set(node, { key, controller });
    const eventOptions = { signal: controller.signal };
    node.classList.remove('egy-media-frame-ready', 'egy-media-frame-error');
    delete node.dataset.mediaFrameReady;
    delete node.dataset.mediaFrameError;
    if (node.tagName === 'IMG') {
      const decode = () => {
        if (node.naturalWidth <= 0) return markError(node, key, 'empty-image');
        const done = () => markReady(node, 'image', key);
        if (typeof node.decode === 'function') node.decode().then(done).catch(() => {
          if (node.naturalWidth > 0) done(); else markError(node, key, 'decode');
        });
        else requestAnimationFrame(() => requestAnimationFrame(done));
      };
      if (node.complete) {
        if (node.naturalWidth > 0) decode(); else if (key) markError(node, key, 'broken-image');
      } else {
        node.addEventListener('load', decode, { once: true, ...eventOptions });
        node.addEventListener('error', () => markError(node, key, 'image-error'), { once: true, ...eventOptions });
      }
      return;
    }
    const decodeFrame = () => {
      if (states.get(node)?.key !== key || node.readyState < 2 || !node.videoWidth || !node.videoHeight) return;
      const done = () => markReady(node, 'video', key);
      if (typeof node.requestVideoFrameCallback === 'function') {
        try { node.requestVideoFrameCallback(() => { if (node.readyState >= 2 && node.videoWidth > 0) done(); }); return; } catch (_) {}
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (node.readyState >= 2 && node.videoWidth > 0) done();
      }));
    };
    node.addEventListener('loadeddata', decodeFrame, eventOptions);
    node.addEventListener('canplay', decodeFrame, eventOptions);
    node.addEventListener('error', () => markError(node, key, node.error?.code || 'video-error'), { once: true, ...eventOptions });
    if (node.readyState >= 2 && node.videoWidth > 0) decodeFrame();
  }
  function scan(root) {
    const scope = root?.querySelectorAll ? root : d;
    if (scope.matches?.('img.post-image, video.post-image, #egybookVideoPlayer, #egybookVideoPoster, .evp-swipe-preview img, .evp-swipe-preview video')) watch(scope);
    scope.querySelectorAll?.('img.post-image, video.post-image, #egybookVideoPlayer, #egybookVideoPoster, .evp-swipe-preview img, .evp-swipe-preview video').forEach(watch);
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
    new MutationObserver(records => records.forEach(record => {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target.tagName === 'SOURCE' && target.parentElement?.tagName === 'VIDEO') watch(target.parentElement);
        else watch(target);
      }
      record.addedNodes?.forEach(node => { if (node.nodeType === 1) scan(node); });
      if (record.type === 'childList' && record.target?.tagName === 'VIDEO') watch(record.target);
    })).observe(d.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'srcset', 'sizes', 'poster']
    });
    if (observer) d.querySelectorAll('video.post-image, #egybookVideoPlayer, .evp-swipe-preview video').forEach(video => observer.observe(video));
    w.addEventListener('pageshow', () => scan(d), { passive: true });
  }
  w.EgyBookMediaFrameGuard = Object.freeze({ version: 2, scan });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window, document);
