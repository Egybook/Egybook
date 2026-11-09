/* EgyBook Media Playback State v1 — one bounded owner for queue resume positions. */
(function (w) {
  'use strict';
  if (w.EgyBookPlaybackState?.version === 1) return;
  const states = new Map();
  const LIMIT = 80;
  function keyOf(key) { return String(key || '').trim(); }
  function save(key, media, extra = {}) {
    const keyValue = keyOf(key);
    if (!keyValue || !media) return false;
    const time = Number(media.currentTime);
    if (!Number.isFinite(time) || time < 0) return false;
    const previous = states.get(keyValue) || {};
    states.delete(keyValue);
    states.set(keyValue, {
      ...previous,
      time,
      paused: !!media.paused,
      rate: Number(media.playbackRate) > 0 ? Number(media.playbackRate) : 1,
      updatedAt: Date.now(),
      ...extra
    });
    while (states.size > LIMIT) states.delete(states.keys().next().value);
    return true;
  }
  function get(key) {
    const keyValue = keyOf(key);
    const value = keyValue ? states.get(keyValue) : null;
    if (!value) return null;
    states.delete(keyValue);
    states.set(keyValue, value);
    return { ...value };
  }
  function clear(key) { return states.delete(keyOf(key)); }
  w.EgyBookPlaybackState = Object.freeze({ version: 1, save, get, clear });
})(window);
