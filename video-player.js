/* EgyBook Video Player module v2009.
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
    if (!replace && modal && (!modal.hidden || modal.classList.contains('open'))) return false;
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
