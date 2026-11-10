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
  const REEL_RATIO = 1.55;
  function fitMode(media, fallback = null) {
    const actual = dimensions(media);
    const width = actual.width || Number(fallback?.width) || 0;
    const height = actual.height || Number(fallback?.height) || 0;
    if (!(width > 0 && height > 0)) return 'pending';
    return height / width >= REEL_RATIO ? 'reel' : 'contained';
  }
  function applyFit(media, box = document.getElementById('egybookVideoBox')) {
    if (!media || !box) return 'pending';
    const mode = fitMode(media);
    if (mode === 'pending') return mode;
    const reel = mode === 'reel';
    box.classList.toggle('evp-reel-fill', reel);
    box.classList.toggle('evp-contained-media', !reel);
    return mode;
  }
  function applyPreviewFit(media, fallback = null) {
    if (!media) return 'pending';
    const mode = fitMode(media, fallback);
    if (mode === 'pending') return mode;
    media.style.objectFit = mode === 'reel' ? 'cover' : 'contain';
    media.style.objectPosition = mode === 'reel' ? 'center center' : 'center center';
    return mode;
  }
  window.EgyBookMediaDisplay = Object.freeze({ version: 1, dimensions, fitMode, applyFit, applyPreviewFit });
})();
