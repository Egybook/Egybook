/* EgyBook V234 — canonical video transition lease guard.
 * Owns only transient listeners/frame callbacks for the existing unified player.
 * It never creates a media element, changes a URL, or controls playback policy.
 */
(() => {
  'use strict';

  if (window.EgyBookVideoTransitionGuardV233?.version === '234.0') return;

  let sequence = 0;
  const activeByPlayer = new WeakMap();

  function current(lease) {
    if (!lease || lease.cancelled || !lease.player) return false;
    return activeByPlayer.get(lease.player) === lease &&
      lease.player.dataset?.egybookTransitionLease === String(lease.id);
  }

  function runCleanups(lease) {
    if (!lease?.cleanups) return;
    for (const cleanup of Array.from(lease.cleanups)) {
      try { cleanup(); } catch (_) {}
    }
    lease.cleanups.clear();
  }

  function begin(player, modal, source) {
    if (!player) return null;
    cancel(player, 'superseded');
    const lease = {
      id: ++sequence,
      player,
      modal: modal || null,
      source: String(source || ''),
      cancelled: false,
      cleanups: new Set()
    };
    activeByPlayer.set(player, lease);
    if (!player.dataset) player.dataset = {};
    player.dataset.egybookTransitionLease = String(lease.id);
    player.dataset.egybookTransitionSource = lease.source;
    return lease;
  }

  function listen(lease, target, type, handler, options = {}) {
    if (!current(lease) || !target?.addEventListener || typeof handler !== 'function') return () => {};
    let attached = true;
    const remove = () => {
      if (!attached) return;
      attached = false;
      try { target.removeEventListener(type, wrapped, options); } catch (_) {}
      lease.cleanups.delete(remove);
    };
    const wrapped = event => {
      if (!current(lease)) { remove(); return; }
      if (options?.once) remove();
      handler(event);
    };
    target.addEventListener(type, wrapped, options);
    lease.cleanups.add(remove);
    return remove;
  }


  function onCancel(lease, cleanup) {
    if (!current(lease) || typeof cleanup !== 'function') return () => {};
    let attached = true;
    const remove = () => {
      if (!attached) return;
      attached = false;
      lease.cleanups.delete(remove);
      try { cleanup(); } catch (_) {}
    };
    lease.cleanups.add(remove);
    return remove;
  }

  function watchPresentedFrame(lease, options = {}) {
    if (!current(lease)) return () => {};
    const player = lease.player;
    const onPresented = typeof options.onPresented === 'function' ? options.onPresented : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    let stopped = false;
    let frameHandle = 0;
    let rafOne = 0;
    let rafTwo = 0;
    let attached = [];

    const minimumTime = () => {
      const raw = typeof options.minimumTime === 'function' ? options.minimumTime() : options.minimumTime;
      return Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : 0;
    };
    const remove = () => {
      if (stopped) return;
      stopped = true;
      attached.forEach(([type, listener]) => {
        try { player.removeEventListener(type, listener); } catch (_) {}
      });
      attached = [];
      if (frameHandle && typeof player.cancelVideoFrameCallback === 'function') {
        try { player.cancelVideoFrameCallback(frameHandle); } catch (_) {}
      }
      if (rafOne) window.cancelAnimationFrame?.(rafOne);
      if (rafTwo) window.cancelAnimationFrame?.(rafTwo);
      frameHandle = rafOne = rafTwo = 0;
      lease.cleanups.delete(remove);
    };
    const frameReady = () => current(lease) && !player.error &&
      Number(player.readyState) >= 2 && Number(player.videoWidth) > 0 && Number(player.videoHeight) > 0 &&
      !player.seeking && Number(player.currentTime || 0) + 0.18 >= minimumTime();
    const finish = () => {
      if (stopped || !frameReady()) return;
      remove();
      if (current(lease)) onPresented();
    };
    const afterPaint = () => {
      if (stopped || !current(lease)) return;
      rafOne = window.requestAnimationFrame(() => {
        rafOne = 0;
        if (!current(lease)) return;
        rafTwo = window.requestAnimationFrame(() => {
          rafTwo = 0;
          finish();
        });
      });
    };
    const inspect = () => {
      if (stopped || !current(lease) || !frameReady()) return;
      if (typeof player.requestVideoFrameCallback === 'function') {
        if (frameHandle) return;
        try {
          frameHandle = player.requestVideoFrameCallback((now, metadata) => {
            frameHandle = 0;
            if (stopped || !current(lease)) return;
            const mediaTime = Number(metadata?.mediaTime);
            if (Number.isFinite(mediaTime) && mediaTime + 0.18 < minimumTime()) return;
            finish();
          });
        } catch (_) { afterPaint(); }
      } else afterPaint();
    };
    const fail = event => {
      if (stopped || !current(lease)) return;
      remove();
      onError(event);
    };
    for (const type of ['loadeddata', 'canplay', 'seeked', 'timeupdate', 'playing']) {
      const listener = inspect;
      player.addEventListener(type, listener, { passive: true });
      attached.push([type, listener]);
    }
    const errorListener = fail;
    player.addEventListener('error', errorListener, { once: true });
    attached.push(['error', errorListener]);
    lease.cleanups.add(remove);
    inspect();
    return remove;
  }

  function cancel(player, reason = 'cancelled') {
    const lease = player && activeByPlayer.get(player);
    if (!lease) return false;
    lease.cancelled = true;
    runCleanups(lease);
    if (activeByPlayer.get(player) === lease) activeByPlayer.delete(player);
    if (player.dataset?.egybookTransitionLease === String(lease.id)) {
      delete player.dataset.egybookTransitionLease;
      delete player.dataset.egybookTransitionSource;
    }
    lease.reason = String(reason || 'cancelled');
    return true;
  }

  window.EgyBookVideoTransitionGuardV233 = Object.freeze({
    version: '234.0',
    begin,
    isCurrent: current,
    listen,
    onCancel,
    watchPresentedFrame,
    cancel
  });
})();
