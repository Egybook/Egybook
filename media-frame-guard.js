/* EgyBook Media Frame Guard v3.0 — readiness only; loading is owned by dedicated media controllers. */
(function (w, d) {
  'use strict';
  if (w.EgyBookMediaFrameGuard?.version === 4) return;
  const states = new WeakMap();
  const frameHealth = new WeakMap();

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

  // One compositor-frame watchdog for the modal player. It distinguishes a
  // genuinely frozen video surface from a naturally static scene: currentTime
  // must advance while requestVideoFrameCallback stops reporting presented
  // frames. Recovery never reloads the source or seeks to zero.
  function watchPresentedFrames(node) {
    if (node.id !== 'egybookVideoPlayer' || typeof node.requestVideoFrameCallback !== 'function') return;
    const key = sourceKey(node);
    let state = frameHealth.get(node);
    if (state?.key === key) return;
    const now = performance.now();
    if (!state) {
      state = { key, frameId: 0, timer: 0, lastFrameAt: now, lastTime: Number(node.currentTime) || 0, lastProgressAt: now, recoveryAt: 0, fallbackVisible: false };
      frameHealth.set(node, state);
      const box = d.getElementById('egybookVideoBox');
      const poster = d.getElementById('egybookVideoPoster');
      const sameSource = () => frameHealth.get(node) === state && sourceKey(node) === state.key;
      const hideFallback = () => {
        if (!state.fallbackVisible || !sameSource()) return;
        state.fallbackVisible = false;
        if (poster) { poster.hidden = true; poster.style.zIndex = ''; poster.style.objectFit = ''; }
        box?.classList.remove('egy-video-frame-recovering');
      };
      const showFallback = () => {
        if (state.fallbackVisible || !sameSource() || !poster || !node.poster) return;
        poster.src = node.poster;
        poster.alt = 'استعادة عرض الفيديو';
        const mode = w.EgyBookMediaDisplay?.modeFor?.(node.videoWidth, node.videoHeight) || 'contained';
        poster.style.objectFit = mode === 'reel' ? 'cover' : 'contain';
        w.EgyBookMediaDisplay?.applyFit?.(node, box);
        poster.hidden = false;
        poster.style.zIndex = '5';
        state.fallbackVisible = true;
        box?.classList.add('egy-video-frame-recovering');
      };
      const onFrame = (frameNow, metadata) => {
        if (!sameSource()) return;
        state.frameId = 0;
        state.lastFrameAt = frameNow;
        if (metadata && Number.isFinite(metadata.mediaTime)) state.lastTime = metadata.mediaTime;
        else state.lastTime = Number(node.currentTime) || state.lastTime;
        state.lastProgressAt = frameNow;
        hideFallback();
        if (!node.paused && !node.ended) {
          try { state.frameId = node.requestVideoFrameCallback(onFrame); } catch (_) { state.frameId = 0; }
        }
      };
      const startFrames = () => {
        if (!sameSource() || node.paused || node.ended || state.frameId) return;
        const frameNow = performance.now();
        state.lastFrameAt = frameNow;
        state.lastProgressAt = frameNow;
        state.lastTime = Number(node.currentTime) || 0;
        try { state.frameId = node.requestVideoFrameCallback(onFrame); } catch (_) {}
      };
      node.addEventListener('playing', startFrames);
      node.addEventListener('seeked', () => {
        if (!sameSource()) return;
        state.lastFrameAt = performance.now();
        state.lastTime = Number(node.currentTime) || 0;
        state.lastProgressAt = state.lastFrameAt;
      });
      node.addEventListener('pause', () => {
        if (state.frameId) { try { node.cancelVideoFrameCallback?.(state.frameId); } catch (_) {} state.frameId = 0; }
      });
      state.timer = setInterval(() => {
        if (!sameSource() || !node.isConnected) return;
        const modal = d.getElementById('egybookVideoModal');
        if (d.hidden || !modal?.classList.contains('open') || node.paused || node.ended || node.seeking || node.readyState < 2) return;
        const tick = performance.now();
        const currentTime = Number(node.currentTime) || 0;
        if (currentTime > state.lastTime + 0.35) {
          state.lastTime = currentTime;
          state.lastProgressAt = tick;
        }
        // No frame callback for 2.2s while media time continues to advance is
        // the reported failure (audio continues, image freezes).
        if (tick - state.lastFrameAt < 2200 || tick - state.lastProgressAt > 1800) return;
        showFallback();
        // At most one lightweight decoder nudge per source/10s. Never call
        // load(), change src, or reset currentTime: preserve the playhead.
        if (tick - state.recoveryAt < 10000) return;
        state.recoveryAt = tick;
        const wasMuted = node.muted;
        try { node.pause(); } catch (_) {}
        requestAnimationFrame(() => {
          if (!sameSource() || !modal?.classList.contains('open') || node.ended) return;
          if (Math.abs((Number(node.currentTime) || 0) - currentTime) > 0.6) return;
          node.muted = wasMuted;
          const attempt = node.play();
          attempt?.catch?.(() => { /* keep the poster fallback; do not expose a blank stage */ });
        });
      }, 500);
    } else {
      if (state.frameId) { try { node.cancelVideoFrameCallback?.(state.frameId); } catch (_) {} }
      state.key = key;
      state.frameId = 0;
      state.lastFrameAt = now;
      state.lastTime = Number(node.currentTime) || 0;
      state.lastProgressAt = now;
      state.recoveryAt = 0;
      state.fallbackVisible = false;
      const poster = d.getElementById('egybookVideoPoster');
      if (poster) { poster.hidden = true; poster.style.zIndex = ''; poster.style.objectFit = ''; }
      d.getElementById('egybookVideoBox')?.classList.remove('egy-video-frame-recovering');
    }
  }

  function watch(node) {
    if (!node || !['IMG', 'VIDEO'].includes(node.tagName)) return;
    if (node.tagName === 'VIDEO') watchPresentedFrames(node);
    const key = sourceKey(node);
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
    // This module only observes readiness and first-frame presentation.
    // Feed autoplay, swipe prewarming and modal playback each have one
    // dedicated owner; this guard must never change preload or call load().
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
    w.addEventListener('pageshow', () => scan(d), { passive: true });
  }
  w.EgyBookMediaFrameGuard = Object.freeze({ version: 4, scan });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window, document);
