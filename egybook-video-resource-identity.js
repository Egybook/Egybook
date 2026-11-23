/* EgyBook V237 — Video resource identity bridge.
 * Keeps a media transition tied to the same logical resource when Hovod
 * rotates a short-lived ticket, and prevents a suspended Reels session from
 * being restored onto a different post/video in the canonical player.
 * This module does not assign media URLs, fetch data, or control playback.
 */
(() => {
  'use strict';

  if (window.EgyBookVideoResourceIdentityV237?.version === '237.0') return;

  function normalize(source) {
    const value = String(source || '').trim();
    if (!value) return '';
    try { return new URL(value, document.baseURI).href; }
    catch (_) { return value; }
  }

  function sameResource(first, second) {
    const a = normalize(first);
    const b = normalize(second);
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      return window.EgyBookVideoURLRenewalV231?.sameResource?.(a, b) === true;
    } catch (_) {
      return false;
    }
  }

  function currentSource(player) {
    if (!player) return '';
    return String(player.getAttribute?.('src') || player.currentSrc || player.src || '').trim();
  }

  function matchesReelsSession(session, modal, player) {
    if (!session || !modal || !player) return false;
    if (!sameResource(session.source, currentSource(player))) return false;

    const expectedPostId = String(session.postId || '').trim();
    const activePostId = String(modal.dataset?.postId || '').trim();
    if (expectedPostId && expectedPostId !== activePostId) return false;
    return true;
  }

  window.EgyBookVideoResourceIdentityV237 = Object.freeze({
    version: '237.0',
    normalize,
    sameResource,
    currentSource,
    matchesReelsSession
  });
})();