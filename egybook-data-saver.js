/* EgyBook Data Saver v43 — real feed/video loading preferences. */
(() => {
  'use strict';
  if (window.EgyBookDataSaver?.version === 43) return;

  const STORAGE_KEY = 'egybook_data_saver_v1';
  const LEGACY_SAVER_KEY = 'egybook-data-saver';
  const LEGACY_QUALITY_KEY = 'egybook-player-quality';
  const QUALITY_VALUES = new Set(['auto', '360', '480', '720', 'original']);
  const connection = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const systemSaveData = () => !!connection()?.saveData || /^(slow-2g|2g)$/i.test(connection()?.effectiveType || '');
  let settings = { enabled: systemSaveData(), videoQuality: 'auto', pauseFeedAutoplay: true };
  let lastAppliedPlayerKey = '';

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      settings = {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : settings.enabled,
        videoQuality: QUALITY_VALUES.has(String(saved.videoQuality)) ? String(saved.videoQuality) : 'auto',
        pauseFeedAutoplay: typeof saved.pauseFeedAutoplay === 'boolean' ? saved.pauseFeedAutoplay : true
      };
    } else if (localStorage.getItem(LEGACY_SAVER_KEY) === 'on') {
      settings.enabled = true;
    }
  } catch (_) {}

  function syncLegacyKeys() {
    try {
      localStorage.setItem(LEGACY_SAVER_KEY, settings.enabled ? 'on' : 'off');
      localStorage.setItem(LEGACY_QUALITY_KEY, settings.videoQuality);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
    document.documentElement.dataset.egyDataSaver = settings.enabled ? 'on' : 'off';
  }

  function emitChange() {
    syncLegacyKeys();
    document.dispatchEvent(new CustomEvent('egybook:data-saver-change', { detail: getSettings() }));
  }

  function getSettings() { return { ...settings }; }
  function update(patch = {}) {
    if (typeof patch.enabled === 'boolean') settings.enabled = patch.enabled;
    if (QUALITY_VALUES.has(String(patch.videoQuality))) settings.videoQuality = String(patch.videoQuality);
    if (typeof patch.pauseFeedAutoplay === 'boolean') settings.pauseFeedAutoplay = patch.pauseFeedAutoplay;
    emitChange();
    return getSettings();
  }

  function shouldPauseFeedAutoplay() { return settings.enabled && settings.pauseFeedAutoplay; }
  function isEnabled() { return settings.enabled; }
  function applyVideoHints(video, { near = false, active = false } = {}) {
    if (!video) return;
    const constrained = settings.enabled || systemSaveData() || Number(navigator.deviceMemory || 4) <= 2;
    video.preload = active && !shouldPauseFeedAutoplay() ? 'auto' : (near ? 'metadata' : 'none');
    try { video.fetchPriority = constrained ? 'low' : (active ? 'high' : 'auto'); } catch (_) {}
    video.dataset.egybookDataSaver = constrained ? 'on' : 'off';
  }
  function applyImageHints(image, near = false) {
    if (!image) return;
    try { image.fetchPriority = settings.enabled ? 'low' : (near ? 'auto' : 'low'); } catch (_) {}
    if ('loading' in image) image.loading = near ? 'eager' : 'lazy';
    if (image.decoding !== 'async') image.decoding = 'async';
  }

  async function applyPlayerQuality() {
    const modal = document.getElementById('egybookVideoModal');
    const player = document.getElementById('egybookVideoPlayer');
    if (!modal?.classList.contains('open') || String(modal.dataset.mediaKind || '') !== 'video' || !player) return false;
    const source = String(player.dataset.egybookOriginalSource || player.getAttribute('src') || player.src || '');
    if (!source || !window.EgyBookVideoTranscoder?.changeQuality) return false;
    const quality = settings.videoQuality;
    // The same modal/player is used by the main video viewer and Reels, so this
    // single preference is applied to both. 'original' actively restores the
    // uploaded source instead of leaving a previous lower rendition attached.
    const key = `${source}|${quality}|${settings.enabled ? 'save' : 'normal'}`;
    if (lastAppliedPlayerKey === key) return false;
    lastAppliedPlayerKey = key;
    try {
      return await window.EgyBookVideoTranscoder.changeQuality(player, source, quality);
    } catch (error) {
      if (lastAppliedPlayerKey === key) lastAppliedPlayerKey = '';
      console.info('[EgyBook data saver] No alternate video rendition applied:', error?.message || error);
      return false;
    }
  }

  syncLegacyKeys();
  document.addEventListener('egybook:evp-player-ready', () => {
    // The player event is emitted just before the new source is attached. A
    // short task delay lets the existing player handoff finish first.
    setTimeout(() => { void applyPlayerQuality(); }, 180);
  });
  document.addEventListener('egybook:data-saver-change', () => { lastAppliedPlayerKey = ''; void applyPlayerQuality(); });
  window.EgyBookDataSaver = Object.freeze({ version: 43, getSettings, update, isEnabled, shouldPauseFeedAutoplay, applyVideoHints, applyImageHints, applyPlayerQuality });
})();
