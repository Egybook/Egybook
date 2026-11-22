/* EgyBook V230.1 — canonical Reels player health inspection.
 * This module only classifies the existing video element; it never changes
 * sources, loads media, or creates a player.
 */
(() => {
  'use strict';
  if (window.EgyBookReelsSessionHealth?.version === '230.1') return;

  function inspect(modal, player) {
    if (!modal || !player) return Object.freeze({ status: 'missing-elements', source: '' });
    const source = String(
      player.currentSrc || player.getAttribute?.('src') ||
      player.dataset?.egybookOriginalSource || player.src || ''
    ).trim();
    if (!source) return Object.freeze({ status: 'missing-source', source: '' });
    if (player.error || Number(player.networkState) === 3) {
      return Object.freeze({ status: 'failed', source });
    }
    if (Number(player.readyState) >= 1) return Object.freeze({ status: 'ready', source });
    return Object.freeze({ status: 'loading', source });
  }

  window.EgyBookReelsSessionHealth = Object.freeze({ version: '230.1', inspect });
})();
