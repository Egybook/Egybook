/* EgyBook Video Player module v2014.
 * Prevents duplicate/re-entrant open requests while a player transition is active.
 */
(function (w) {
  'use strict';
  if (w.EgyBookVideoPlayer) return;
  let openingSource = '';
  let openingAt = 0;
  let transitionToken = 0;
  function claimOpen(source, modal, replace = false) {
    const src = String(source || '');
    const now = Date.now();
    if (!src) return false;
    // .open is the authoritative transition state. Some legacy close paths
    // removed .open but left hidden=false, which must not block future opens.
    if (!replace && modal && modal.classList.contains('open')) return false;
    if (!replace && openingSource && now - openingAt < 1800) return false;
    openingSource = src;
    openingAt = now;
    transitionToken++;
    return true;
  }
  function release() {
    openingSource = '';
    openingAt = 0;
    transitionToken++;
  }
  function isOpening() { return !!openingSource; }
  function getToken() { return transitionToken; }
  w.EgyBookVideoPlayer = Object.freeze({ claimOpen, release, isOpening, getToken });
})(window);
