/* EgyBook Smart Video Adaptation Engine v50
 * Advisory policy only: selects conservative adjacent-preview preload hints.
 * It never changes the core player's source, quality, autoplay, or audio owner.
 */
(() => {
  'use strict';
  if (window.EgyBookVideoAdaptation?.version === 50) return;

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

    // Be conservative only when a real constraint is exposed by the browser.
    const verySlowNetwork = offline || saver || type === 'slow-2g' || type === '2g' ||
      (rtt >= 1200) || (downlink > 0 && downlink <= 0.5);
    const constrainedDevice = (memory > 0 && memory <= 2) || (cores > 0 && cores <= 2);
    const moderateNetwork = type === '3g' || (rtt >= 700) || (downlink > 0 && downlink < 1.5);
    const moderateDevice = (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);

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
      hardwareConcurrency: cores || null
    });
  }

  function getAdjacentPreloadMode() {
    return getPolicy().preload;
  }

  window.EgyBookVideoAdaptation = Object.freeze({
    version: 50,
    getPolicy,
    getAdjacentPreloadMode
  });
})();
