/* EgyBook Video Player module v2015.
 * Rejects duplicate same-source opens without imposing a blanket cooldown.
 * The visible modal state is authoritative; a failed transition can be retried.
 */
(function (w) {
  'use strict';
  if (w.EgyBookVideoPlayer?.version === 2015) return;

  let openingSource = '';
  let openingAt = 0;
  let transitionToken = 0;

  function claimOpen(source, modal, replace = false) {
    const src = String(source || '').trim();
    const now = Date.now();

    if (!src) return { ok: false, reason: 'no-source' };

    if (!replace && modal?.classList?.contains('open')) {
      return { ok: false, reason: 'already-open' };
    }

    // A physical tap can produce both a pointer-driven fallback and a native
    // click. Suppress only the same source during that short duplicate window.
    // A different source, or a retry after the window, is never blocked by a
    // global 1.8-second cooldown.
    if (!replace && openingSource === src && now - openingAt < 650) {
      return { ok: false, reason: 'duplicate-request' };
    }

    openingSource = src;
    openingAt = now;
    transitionToken += 1;
    return { ok: true, token: transitionToken };
  }

  function release(token) {
    // A stale timeout must not release a newer open request.
    if (token != null && token !== transitionToken) return false;
    openingSource = '';
    openingAt = 0;
    transitionToken += 1;
    return true;
  }

  function isOpening() { return !!openingSource; }
  function getToken() { return transitionToken; }

  w.EgyBookVideoPlayer = Object.freeze({
    version: 2015,
    claimOpen,
    release,
    isOpening,
    getToken
  });
})(window);
