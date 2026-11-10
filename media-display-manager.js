/* EgyBook Media Display Manager v1 — the sole owner of source-ratio fitting. */
(() => {
  'use strict';
  if (window.EgyBookMediaDisplay?.version === 2) return;
  function dimensions(media) {
    return {
      width: Number(media?.videoWidth || media?.naturalWidth || media?.width || 0),
      height: Number(media?.videoHeight || media?.naturalHeight || media?.height || 0)
    };
  }
  function modeFor(width, height) {
    width = Number(width) || 0; height = Number(height) || 0;
    if (!(width > 0 && height > 0)) return 'pending';
    return height / width >= 1.55 ? 'reel' : 'contained';
  }
  function applyFit(media, box = document.getElementById('egybookVideoBox')) {
    if (!media || !box) return 'pending';
    const { width, height } = dimensions(media);
    const mode = modeFor(width, height);
    if (mode === 'pending') return mode;
    const reel = mode === 'reel';
    box.classList.toggle('evp-reel-fill', reel);
    box.classList.toggle('evp-contained-media', !reel);
    // Deliberately do not toggle the legacy evp-portrait-stage class. It was
    // also changed by caption/swipe code and caused post-first-frame resizing.
    return reel ? 'reel' : 'contained';
  }
  window.EgyBookMediaDisplay = Object.freeze({ version: 2, dimensions, modeFor, applyFit });
})();
