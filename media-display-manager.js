/* EgyBook Media Display Manager v1 — the sole owner of source-ratio fitting. */
(() => {
  'use strict';
  if (window.EgyBookMediaDisplay?.version === 1) return;
  function dimensions(media) {
    return {
      width: Number(media?.videoWidth || media?.naturalWidth || media?.width || 0),
      height: Number(media?.videoHeight || media?.naturalHeight || media?.height || 0)
    };
  }
  function applyFit(media, box = document.getElementById('egybookVideoBox')) {
    if (!media || !box) return 'pending';
    const { width, height } = dimensions(media);
    if (!(width > 0 && height > 0)) return 'pending';
    const ratio = height / width;
    const reel = ratio >= 1.55;
    box.classList.toggle('evp-reel-fill', reel);
    box.classList.toggle('evp-contained-media', !reel);
    // Deliberately do not toggle the legacy evp-portrait-stage class. It was
    // also changed by caption/swipe code and caused post-first-frame resizing.
    return reel ? 'reel' : 'contained';
  }
  window.EgyBookMediaDisplay = Object.freeze({ version: 1, dimensions, applyFit });
})();
