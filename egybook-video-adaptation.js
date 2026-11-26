/* EgyBook Smart Video Adaptation Engine v247
 * Advisory policy only: selects conservative adjacent-preview preload hints.
 * It never changes the core player's source, quality, autoplay, or audio owner.
 */
(() => {
  'use strict';
  if (window.EgyBookVideoAdaptation?.version === 247) return;

  const connection = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function getPolicy() {
    const net = connection();
    const type = String(net?.effectiveType || '').toLowerCase();
    const rtt = finite(net?.rtt);
    const downlink = finite(net?.downlink);
    const memory = finite(navigator.deviceMemory);
    const cores = finite(navigator.hardwareConcurrency);
    const saver = !!net?.saveData || !!window.EgyBookDataSaver?.isEnabled?.();
    const offline = navigator.onLine === false;
    let profile = null;
    try { profile = window.EgyBookPerformance?.getSnapshot?.() || null; } catch (_) {}
    const runtimePressure = profile?.pressure === true;
    const knownTier = profile?.signalConfidence !== 'no-hints';
    const tierOne = knownTier && profile?.deviceTier === 'L1';
    const tierTwo = knownTier && profile?.deviceTier === 'L2';

    // Be conservative only when a real constraint is exposed by the browser.
    const verySlowNetwork = offline || saver || runtimePressure || type === 'slow-2g' || type === '2g' ||
      (rtt >= 1200) || (downlink > 0 && downlink <= 0.5);
    const constrainedDevice = (memory > 0 && memory <= 2) || (cores > 0 && cores <= 2) || tierOne;
    const moderateNetwork = type === '3g' || (rtt >= 700) || (downlink > 0 && downlink < 1.5);
    const moderateDevice = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) || tierTwo;

    let preload = 'auto';
    let tier = 'full';
    if (verySlowNetwork || constrainedDevice) {
      preload = 'metadata';
      tier = 'conservative';
    } else if (moderateNetwork || moderateDevice) {
      preload = 'metadata';
      tier = 'balanced';
    }

    return Object.freeze({
      preload,
      tier,
      online: !offline,
      saveData: saver,
      effectiveType: type || 'unknown',
      rtt,
      downlink,
      deviceMemory: memory || null,
      hardwareConcurrency: cores || null,
      deviceTier: profile?.deviceTier || 'unknown',
      runtimePressure
    });
  }

  function getAdjacentPreloadMode(priority = 'next') {
    // One shared decision is used by the warm cache, swipe preview, and
    // canonical queue preparation. Explicit user choices always win.
    let settings = {};
    try { settings = window.EgyBookDataSaver?.getSettings?.() || {}; } catch (_) {}
    const requested = String(settings.preloadMode || 'auto');
    if (requested === 'none') return 'none';
    if (requested === 'metadata') return 'metadata';

    const policy = getPolicy().preload;
    if (policy !== 'auto') return policy;
    // Keep only the likely next item fully warm; the previous item stays
    // metadata-only to avoid warming two large files in parallel.
    return priority === 'next' ? 'auto' : 'metadata';
  }

  window.EgyBookVideoAdaptation = Object.freeze({
    version: 247,
    getPolicy,
    getAdjacentPreloadMode
  });
})();
