/* EgyBook V241 — Unified Reels playback/audio handoff coordinator.
 * Coordinates the existing canonical media elements only. It creates no
 * player, AudioContext, network request, storage entry, or gesture handler.
 * The adjacent swipe preview remains visual-only and muted; the canonical
 * player (or the existing companion audio element for legacy media) is the
 * only audible owner after a handoff.
 */
(() => {
  'use strict';
  const API_KEY = 'EgyBookReelsPlaybackCoordinatorV239';
  if (window[API_KEY]?.version === '243.0') return;

  let sequence = 0;
  let active = null;
  const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 1));
  const now = () => Number(window.performance?.now?.() || Date.now());

  function sameSource(media, source) {
    const current = String(media?.currentSrc || media?.getAttribute?.('src') || media?.src || '');
    return current === source;
  }

  function setVolume(media, value) {
    if (!media) return false;
    const target = clamp(value);
    try {
      media.volume = target;
      return Math.abs(Number(media.volume) - target) < 0.035;
    } catch (_) {
      return false;
    }
  }

  function setMuted(media, muted) {
    if (!media) return;
    try {
      media.muted = !!muted;
      if (muted) media.setAttribute?.('muted', '');
      else media.removeAttribute?.('muted');
    } catch (_) {}
  }

  function isCurrent(token) {
    return !!active && !active.cancelled && active.token === Number(token?.token ?? token);
  }

  function animateVolume(media, target, duration, token) {
    if (!media) return Promise.resolve(false);
    const destination = clamp(target);
    const startVolume = clamp(media.volume);
    if (Math.abs(startVolume - destination) < 0.008) return Promise.resolve(true);
    if (duration <= 0) return Promise.resolve(setVolume(media, destination));
    if (document.hidden) return Promise.resolve(setVolume(media, destination));
    return new Promise(resolve => {
      const startedAt = now();
      let frameId = 0;
      let fallbackTimer = 0;
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        if (frameId) window.cancelAnimationFrame?.(frameId);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        resolve(!!ok);
      };
      const tick = timestamp => {
        if (!isCurrent(token)) { finish(false); return; }
        const elapsed = Math.max(0, Number(timestamp) - startedAt);
        const progress = Math.min(1, elapsed / duration);
        const eased = progress * progress * (3 - 2 * progress);
        const adjusted = setVolume(media, startVolume + ((destination - startVolume) * eased));
        if (!adjusted) {
          // Some mobile browsers do not expose a writable media volume.
          // Muting is the safe handoff fallback: never leave two sources audible.
          setMuted(media, true);
          finish(false);
          return;
        }
        if (progress >= 1) {
          const completed = setVolume(media, destination);
          if (!completed) setMuted(media, true);
          finish(completed);
        } else {
          frameId = window.requestAnimationFrame(tick);
        }
      };
      if (typeof window.requestAnimationFrame === 'function') {
        frameId = window.requestAnimationFrame(tick);
        fallbackTimer = setTimeout(() => {
          if (!settled && isCurrent(token)) {
            const completed = setVolume(media, destination);
            if (!completed) setMuted(media, true);
            finish(completed);
          }
        }, duration + 120);
      } else {
        fallbackTimer = setTimeout(() => {
          const current = isCurrent(token);
          const completed = current && setVolume(media, destination);
          if (current && !completed) setMuted(media, true);
          finish(completed);
        }, duration);
      }
    });
  }

  async function beginHandoff(options = {}) {
    const previous = active;
    const elements = Array.from(new Set((options.elements || []).filter(Boolean)));
    const audible = elements.filter(media => !media.paused && !media.ended &&
      !media.muted && clamp(media.volume) > 0);
    const owner = options.owner || audible[0] || elements.find(media => media && !media.paused) || elements[0] || null;
    // If a second swipe supersedes an in-flight fade, inherit the intended
    // user volume/mute state rather than mistaking a partially faded volume
    // value for the user's actual setting.
    const inheritedSettings = previous && owner &&
      (previous.incoming === owner || previous.outgoing.some(item => item.media === owner))
      ? { muted: previous.targetMuted, volume: previous.targetVolume }
      : null;
    if (previous) cancel(previous, { restoreOutgoing: false, restoreIncoming: false });
    const token = ++sequence;
    const requestedFadeInMs = options.fadeInMs === undefined ? 90 : Number(options.fadeInMs);
    const record = {
      token,
      reason: String(options.reason || 'reels-swipe'),
      targetMuted: inheritedSettings ? inheritedSettings.muted : (owner ? !!owner.muted : false),
      targetVolume: inheritedSettings ? inheritedSettings.volume : (owner ? clamp(owner.volume) : 1),
      outgoing: elements.map(media => ({
        media,
        volume: clamp(media.volume),
        muted: !!media.muted,
        source: String(media.currentSrc || media.getAttribute?.('src') || media.src || '')
      })),
      incoming: null,
      cancelled: false,
      startedAt: now(),
      fadeOutMs: Math.max(0, Math.min(120, Number(options.fadeOutMs) || 55)),
      fadeInMs: Number.isFinite(requestedFadeInMs) ? Math.max(0, Math.min(180, requestedFadeInMs)) : 90,
      muteGate: false,
      state: 'fading-out'
    };
    active = record;
    await Promise.all(audible.map(async media => {
      const faded = await animateVolume(media, 0, record.fadeOutMs, token);
      if (!faded && isCurrent(token)) {
        setMuted(media, true);
        record.forcedMute = true;
      }
    }));
    if (!isCurrent(token)) return null;
    record.state = 'ready-for-incoming';
    return Object.freeze({ token, muted: record.targetMuted, volume: record.targetVolume, reason: record.reason });
  }

  function getSettings(session) {
    if (!isCurrent(session)) return null;
    return Object.freeze({ muted: active.targetMuted, volume: active.targetVolume });
  }

  // A queued `playing` event from the outgoing source can arrive after the
  // canonical player has been handed to a new transition. Never treat it as
  // proof that the incoming resource has started. The exact prepared element,
  // its play state, and its current resource must all match the active lease.
  function isIncomingReady(session, media, expectedSource) {
    if (!isCurrent(session) || !media || active.incoming !== media || media.paused || media.ended) return false;
    const expected = String(expectedSource || '').trim();
    if (!expected) return true;
    const assigned = String(media.getAttribute?.('src') || media.src || '').trim();
    const current = String(media.currentSrc || '').trim();
    const identity = window.EgyBookVideoResourceIdentityV237;
    const matches = candidate => {
      if (!candidate) return false;
      try {
        if (identity?.sameResource) return identity.sameResource(candidate, expected) === true;
      } catch (_) {}
      try {
        return new URL(candidate, document.baseURI).href === new URL(expected, document.baseURI).href;
      } catch (_) {
        return candidate === expected;
      }
    };
    return matches(assigned) && (!current || matches(current));
  }

  function prepareIncoming(session, media) {
    if (!isCurrent(session) || !media) return false;
    active.incoming = media;
    active.state = 'incoming-prepared';
    setMuted(media, active.targetMuted);
    // Keep a new unmuted clip inaudible until the canonical player reports that
    // playback has actually started. Where a platform does not allow scripted
    // volume changes (notably some iOS media paths), use a temporary mute gate.
    if (!active.targetMuted) {
      if (!setVolume(media, 0)) {
        active.muteGate = true;
        setMuted(media, true);
      }
    } else setVolume(media, active.targetVolume);
    return true;
  }

  async function activateIncoming(session, media) {
    if (!isCurrent(session) || !media || (active.incoming && active.incoming !== media)) return false;
    active.incoming = media;
    if (active.targetMuted || active.targetVolume <= 0) {
      const record = active;
      setMuted(media, record.targetMuted);
      setVolume(media, record.targetVolume);
      record.state = 'incoming-active';
      if (active === record) active = null;
      return true;
    }
    if (media.paused || media.ended) return false;
    const record = active;
    if (record.muteGate) {
      // Playback has started while muted; now release the gate. The browser's
      // hardware volume remains authoritative when the volume property is read-only.
      setVolume(media, record.targetVolume);
      setMuted(media, false);
      record.state = 'incoming-active';
      if (active === record) active = null;
      return true;
    }
    setMuted(media, false);
    active.state = 'fading-in';
    const completed = await animateVolume(media, record.targetVolume, record.fadeInMs, record.token);
    if (completed && isCurrent(session)) {
      record.state = 'incoming-active';
      if (active === record) active = null;
    }
    return completed;
  }

  function restoreIncoming(session, media) {
    if (!isCurrent(session) || !media) return false;
    if (!media.paused && !media.ended) return false;
    setVolume(media, active.targetVolume);
    setMuted(media, active.targetMuted);
    active.state = 'incoming-ready';
    return true;
  }

  function cancel(session, options = {}) {
    if (!isCurrent(session)) return false;
    const record = active;
    record.cancelled = true;
    active = null;
    if (options.restoreOutgoing !== false) {
      for (const item of record.outgoing) {
        if (sameSource(item.media, item.source)) {
          setVolume(item.media, item.volume);
          setMuted(item.media, item.muted);
        }
      }
    }
    if (options.restoreIncoming !== false && record.incoming &&
        (record.incoming.paused || record.incoming.ended)) {
      setVolume(record.incoming, record.targetVolume);
      setMuted(record.incoming, record.targetMuted);
    }
    return true;
  }

  window[API_KEY] = Object.freeze({
    version: '243.0',
    beginHandoff,
    getSettings,
    isIncomingReady,
    prepareIncoming,
    activateIncoming,
    restoreIncoming,
    cancel,
    isCurrent
  });
})();
