/* EgyBook V231 — Hovod secure-video URL renewal and metadata recovery.
 * This module is intentionally separate from script.js and the canonical player.
 * It renews only Hovod private-playback URLs; stable R2 /media URLs are untouched.
 * Renewal is proactive and uses Hovod's current-ticket endpoint; expired tickets
 * fail closed because the Hovod API intentionally refuses expired-ticket refresh.
 * No secrets or short-lived tickets are written to storage or console output.
 */
(() => {
  'use strict';

  if (window.EgyBookVideoURLRenewalV231?.version === 231) return;

  const PLAYER_ID = 'egybookVideoPlayer';
  const REFRESH_LEAD_SECONDS = 90;
  const REQUEST_TIMEOUT_MS = 7000;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [2500, 6000, 12000];
  const states = new Map();
  const renewalJobs = new Map();
  const boundVideos = new WeakSet();
  let observer = null;
  let initialized = false;

  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes);
    let escaped = '';
    bytes.forEach(byte => { escaped += `%${byte.toString(16).padStart(2, '0')}`; });
    return decodeURIComponent(escaped);
  }

  function readTicketClaims(ticket) {
    const parts = String(ticket || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    try {
      const payload = JSON.parse(decodeBase64Url(parts[0]));
      if (!payload || payload.aud !== 'hovod-playback' || payload.iss !== 'egybook' ||
          typeof payload.pid !== 'string' || !payload.pid ||
          typeof payload.sub !== 'string' || !payload.sub ||
          typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.jti) ||
          !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
          payload.exp <= payload.iat || payload.exp - payload.iat > 600) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function inspectSource(source) {
    if (!source) return null;
    let url;
    try { url = new URL(String(source), document.baseURI); }
    catch (_) { return null; }
    // Private playback tickets must never be renewed over plaintext HTTP.
    if (url.protocol !== 'https:') return null;

    const match = url.pathname.match(/^\/v1\/secure-playback\/([A-Za-z0-9_-]{8,128})\/(.+)$/);
    if (!match || /\/refresh\/?$/i.test(url.pathname)) return null;

    const playbackId = match[1];
    const ticket = String(url.searchParams.get('ticket') || '');
    const claims = ticket ? readTicketClaims(ticket) : null;
    // A structurally valid current ticket is mandatory. Missing or malformed
    // tickets are not grounds to mint/retrieve credentials for a media URL.
    if (!ticket || !claims || claims.pid !== playbackId) return null;

    return {
      origin: url.origin,
      playbackId,
      ticket,
      claims,
      exp: claims?.exp || 0,
      subject: claims?.sub || '',
      jti: claims?.jti || '',
      identity: `${url.origin}/v1/secure-playback/${playbackId}`,
      sourceUrl: url.href
    };
  }

  function sameResource(first, second) {
    if (String(first || '') === String(second || '')) return true;
    const a = inspectSource(first);
    const b = inspectSource(second);
    return !!a && !!b && a.identity === b.identity;
  }

  function readVideoSource(video) {
    if (!video) return '';
    return String(video.getAttribute?.('src') || video.dataset?.feedSrc ||
      video.currentSrc || video.src || '').trim();
  }

  function clearTimer(state) {
    if (state?.timer) clearTimeout(state.timer);
    if (state?.retryTimer) clearTimeout(state.retryTimer);
    if (state) { state.timer = 0; state.retryTimer = 0; }
  }

  function stopTracking(video) {
    const state = states.get(video);
    if (!state) return;
    clearTimer(state);
    states.delete(video);
  }

  function scheduleRefresh(video, state) {
    clearTimeout(state.timer);
    state.timer = 0;
    if (state.blocked || !video.isConnected) return;

    const current = inspectSource(readVideoSource(video));
    if (!current || current.identity !== state.identity) return;
    state.source = current.sourceUrl;
    state.ticket = current.ticket;
    state.exp = current.exp;

    const now = Date.now();
    const dueAt = current.exp ? current.exp * 1000 - REFRESH_LEAD_SECONDS * 1000 : now;
    const delay = Math.max(0, Math.min(0x7fffffff, dueAt - now));
    state.timer = setTimeout(() => {
      state.timer = 0;
      refreshNow(video, 'scheduled').catch(() => {});
    }, delay);
  }

  function createSnapshot(video, identity) {
    return {
      identity,
      time: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
      wasPlaying: !video.paused && !video.ended,
      ended: !!video.ended,
      muted: !!video.muted,
      volume: Number.isFinite(video.volume) ? Math.max(0, Math.min(1, video.volume)) : 1,
      playbackRate: Number.isFinite(video.playbackRate) ? Math.max(0.25, Math.min(4, video.playbackRate)) : 1,
      capturedAt: Date.now()
    };
  }

  function finishRestore(video, state, snapshot) {
    if (!snapshot || state.pendingRestore !== snapshot || !video.isConnected) return;
    const current = inspectSource(readVideoSource(video));
    if (!current || current.identity !== snapshot.identity) {
      state.pendingRestore = null;
      return;
    }

    try {
      video.muted = snapshot.muted;
      video.volume = snapshot.volume;
      video.playbackRate = snapshot.playbackRate;
    } catch (_) {}

    if (snapshot.wasPlaying && document.hidden) {
      // Keep the resume snapshot until the page is visible again; do not lose
      // the pre-renewal playing state merely because background playback is paused.
      state.pendingRestore = snapshot;
      return;
    }
    if (snapshot.wasPlaying && video.paused && !video.ended) {
      try {
        const playAttempt = video.play();
        if (playAttempt?.catch) playAttempt.catch(() => {});
      } catch (_) {}
    }
    state.pendingRestore = null;
    window.dispatchEvent(new CustomEvent('egybook:video-source-restored', {
      detail: { playbackId: current.playbackId, time: snapshot.time, wasPlaying: snapshot.wasPlaying }
    }));
  }

  function restoreAfterMetadata(video, state) {
    const snapshot = state?.pendingRestore;
    if (!snapshot || state.blocked || !video.isConnected || video.readyState < 1) return false;
    const current = inspectSource(readVideoSource(video));
    if (!current || current.identity !== snapshot.identity) return false;

    try {
      video.muted = snapshot.muted;
      video.volume = snapshot.volume;
      video.playbackRate = snapshot.playbackRate;
    } catch (_) {}

    let target = snapshot.time;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      target = Math.min(target, Math.max(0, video.duration - 0.08));
    } else if (!Number.isFinite(video.duration) || video.duration <= 0) {
      target = 0;
    }

    if (target > 0.15 && Math.abs((Number(video.currentTime) || 0) - target) > 0.3) {
      try { video.currentTime = target; }
      catch (_) { finishRestore(video, state, snapshot); return false; }
      if (video.seeking) {
        const token = state.generation;
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          clearTimeout(fallback);
          if (token === state.generation) finishRestore(video, state, snapshot);
        };
        const fallback = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          if (token === state.generation) finishRestore(video, state, snapshot);
        }, 1800);
        video.addEventListener('seeked', onSeeked, { once: true });
        return true;
      }
    }
    finishRestore(video, state, snapshot);
    return true;
  }

  function showUnavailable(video, state, reason) {
    if (state.blocked) return;
    state.blocked = true;
    clearTimer(state);
    try { video.pause(); } catch (_) {}
    video.dataset.egybookPlaybackUnavailable = 'true';
    if (video.id === PLAYER_ID) {
      const notice = document.getElementById('evpNotice');
      if (notice) notice.textContent = reason === 'forbidden'
        ? 'هذا الفيديو لم يعد متاحًا لك.'
        : 'تعذر تجديد صلاحية تشغيل الفيديو. تحقق من الاتصال وحاول مرة أخرى.';
    }
    const current = inspectSource(readVideoSource(video));
    window.dispatchEvent(new CustomEvent('egybook:video-source-renewal-failed', {
      detail: { playbackId: current?.playbackId || '', reason }
    }));
  }

  async function requestJson(url, options = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
    try {
      const response = await window.fetch(url, {
        ...options,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        ...(controller ? { signal: controller.signal } : {})
      });
      const data = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, data };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function validateReplacementTicket(ticket, current, playbackId) {
    const claims = readTicketClaims(ticket);
    if (!claims || claims.pid !== playbackId || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (current?.claims) {
      if (claims.sub !== current.claims.sub || claims.jti === current.claims.jti || claims.exp <= current.claims.exp) return null;
    }
    return claims;
  }

  async function tryHovodRefresh(descriptor) {
    if (!descriptor.ticket || !descriptor.claims) {
      const error = new Error('current-ticket-missing-or-invalid');
      error.stage = 'ticket-refresh';
      error.status = 403;
      throw error;
    }
    if (descriptor.exp <= Math.floor(Date.now() / 1000)) {
      const error = new Error('current-ticket-expired');
      error.stage = 'ticket-refresh';
      error.status = 403;
      throw error;
    }
    const endpoint = new URL(`/v1/secure-playback/${encodeURIComponent(descriptor.playbackId)}/refresh`, descriptor.origin);
    const result = await requestJson(endpoint.href, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ ticket: descriptor.ticket })
    });
    if (!result.ok) {
      const error = new Error('hovod-ticket-refresh-failed');
      error.stage = 'ticket-refresh';
      error.status = result.status;
      throw error;
    }
    const ticket = result.data?.data?.ticket;
    if (!validateReplacementTicket(ticket, descriptor, descriptor.playbackId)) {
      const error = new Error('hovod-ticket-refresh-invalid-response');
      error.stage = 'ticket-refresh';
      error.status = 502;
      throw error;
    }
    return ticket;
  }


  async function loadManifestUrl(descriptor, ticket) {
    const endpoint = new URL(`/v1/secure-playback/${encodeURIComponent(descriptor.playbackId)}`, descriptor.origin);
    endpoint.searchParams.set('ticket', ticket);
    const result = await requestJson(endpoint.href, { method: 'GET', mode: 'cors', headers: { 'Accept': 'application/json' } });
    if (!result.ok) {
      const error = new Error('manifest-refresh-failed');
      error.stage = 'manifest';
      error.status = result.status;
      throw error;
    }
    const rawUrl = result.data?.data?.manifestUrl;
    if (typeof rawUrl !== 'string' || !rawUrl) {
      const error = new Error('manifest-url-missing');
      error.stage = 'manifest';
      error.status = 502;
      throw error;
    }
    const manifestUrl = new URL(rawUrl, descriptor.origin);
    const expectedPrefix = `/v1/secure-playback/${descriptor.playbackId}/`;
    if (manifestUrl.origin !== descriptor.origin || !manifestUrl.pathname.startsWith(expectedPrefix)) {
      const error = new Error('manifest-url-outside-secure-playback');
      error.stage = 'manifest';
      error.status = 502;
      throw error;
    }
    if (manifestUrl.searchParams.get('ticket') !== ticket) manifestUrl.searchParams.set('ticket', ticket);
    return manifestUrl.href;
  }

  async function obtainRenewedManifest(descriptor) {
    // Hovod deliberately requires a still-valid current ticket for refresh.
    // Do not issue a new ticket from the browser: without a configured trusted
    // Hovod-origin allowlist that would risk sending a freshly minted ticket to
    // an untrusted host supplied through media metadata. Proactive renewal is
    // scheduled before expiry; an already-expired ticket fails closed.
    const ticket = await tryHovodRefresh(descriptor);
    const claims = validateReplacementTicket(ticket, descriptor, descriptor.playbackId);
    if (!claims) {
      const error = new Error('invalid-replacement-ticket');
      error.stage = 'ticket-issue';
      error.status = 502;
      throw error;
    }
    const manifestUrl = await loadManifestUrl(descriptor, ticket);
    return { ticket, claims, manifestUrl };
  }

  function getRenewalJob(descriptor) {
    const key = `${descriptor.identity}|${descriptor.ticket || 'missing-ticket'}`;
    if (renewalJobs.has(key)) return renewalJobs.get(key);
    const job = obtainRenewedManifest(descriptor).finally(() => renewalJobs.delete(key));
    renewalJobs.set(key, job);
    return job;
  }

  function applyRenewedManifest(video, state, descriptor, renewed, snapshot) {
    if (!video.isConnected || state.blocked || state.identity !== descriptor.identity) return false;
    const live = inspectSource(readVideoSource(video));
    if (!live || live.identity !== descriptor.identity || live.ticket !== descriptor.ticket) return false;

    state.pendingRestore = snapshot || createSnapshot(video, descriptor.identity);
    state.source = renewed.manifestUrl;
    state.ticket = renewed.ticket;
    state.exp = renewed.claims.exp;
    state.retryCount = 0;
    state.blocked = false;
    state.generation += 1;
    delete video.dataset.egybookPlaybackUnavailable;
    if (video.id === PLAYER_ID) video.dataset.egybookOriginalSource = renewed.manifestUrl;

    const hasAttachedSource = !!video.getAttribute?.('src');
    if (!hasAttachedSource && video.dataset?.feedSrc) {
      video.dataset.feedSrc = renewed.manifestUrl;
      scheduleRefresh(video, state);
      window.dispatchEvent(new CustomEvent('egybook:video-source-renewed', {
        detail: { playbackId: descriptor.playbackId, attached: false }
      }));
      return true;
    }

    try {
      if (snapshot?.wasPlaying) video.pause();
      // Setting src starts the browser's resource-selection cycle. Do not call
      // load() again: that would restart the same request and discard progress.
      video.src = renewed.manifestUrl;
    } catch (_) {
      state.pendingRestore = null;
      return false;
    }

    scheduleRefresh(video, state);
    window.dispatchEvent(new CustomEvent('egybook:video-source-renewed', {
      detail: { playbackId: descriptor.playbackId, attached: true }
    }));
    if (video.readyState >= 1) restoreAfterMetadata(video, state);
    return true;
  }

  function scheduleRetry(video, state, error) {
    state.retryCount += 1;
    const status = Number(error?.status || 0);
    const forbidden = ['ticket-issue', 'ticket-refresh'].includes(error?.stage) && [401, 403, 404].includes(status);
    const unavailable = error?.stage === 'manifest' && [401, 403, 404, 410].includes(status);
    if (forbidden || unavailable) {
      showUnavailable(video, state, 'forbidden');
      return;
    }
    if (state.retryCount > MAX_RETRIES || !video.isConnected) {
      showUnavailable(video, state, 'retry-exhausted');
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(state.retryCount - 1, RETRY_DELAYS_MS.length - 1)];
    state.retryTimer = setTimeout(() => {
      state.retryTimer = 0;
      refreshNow(video, 'retry').catch(() => {});
    }, delay);
  }

  async function refreshNow(video, reason = 'manual') {
    if (!video) return { ok: false, reason: 'missing-video' };
    let state = states.get(video);
    if (!state) {
      attach(video);
      state = states.get(video);
    }
    if (!state || state.blocked) return { ok: false, reason: 'not-renewable' };
    if (state.refreshPromise) return state.refreshPromise;

    const descriptor = inspectSource(readVideoSource(video));
    if (!descriptor || descriptor.identity !== state.identity) return { ok: false, reason: 'source-changed' };
    if (!video.isConnected) { stopTracking(video); return { ok: false, reason: 'detached' }; }

    clearTimeout(state.timer);state.timer=0;
    clearTimeout(state.retryTimer);state.retryTimer=0;
    const snapshot = createSnapshot(video, descriptor.identity);
    state.refreshing = true;
    state.lastReason = reason;
    const promise = (async () => {
      try {
        const renewed = await getRenewalJob(descriptor);
        const current = inspectSource(readVideoSource(video));
        if (!current || current.identity !== descriptor.identity || current.ticket !== descriptor.ticket) {
          return { ok: false, reason: 'superseded' };
        }
        const applied = applyRenewedManifest(video, state, descriptor, renewed, snapshot);
        if (!applied) throw new Error('source-apply-failed');
        return { ok: true, playbackId: descriptor.playbackId, exp: renewed.claims.exp };
      } catch (error) {
        scheduleRetry(video, state, error);
        return { ok: false, reason: error?.stage || 'renewal-failed', status: Number(error?.status || 0) };
      } finally {
        state.refreshing = false;
        state.refreshPromise = null;
      }
    })();
    state.refreshPromise = promise;
    return promise;
  }

  function ensureState(video) {
    if (!video || video.tagName !== 'VIDEO') return null;
    const descriptor = inspectSource(readVideoSource(video));
    const previous = states.get(video);
    if (!descriptor) {
      if (previous) stopTracking(video);
      return null;
    }

    if (previous && previous.identity === descriptor.identity) {
      const changedTicket = previous.ticket !== descriptor.ticket;
      previous.source = descriptor.sourceUrl;
      previous.ticket = descriptor.ticket;
      previous.exp = descriptor.exp;
      if (changedTicket && !previous.refreshing) {
        previous.retryCount = 0;
        previous.blocked = false;
        scheduleRefresh(video, previous);
      } else if (!previous.timer && !previous.retryTimer && !previous.refreshing && !previous.blocked) {
        scheduleRefresh(video, previous);
      }
      return previous;
    }

    if (previous) clearTimer(previous);
    const state = {
      identity: descriptor.identity,
      source: descriptor.sourceUrl,
      ticket: descriptor.ticket,
      exp: descriptor.exp,
      timer: 0,
      retryTimer: 0,
      retryCount: 0,
      generation: (previous?.generation || 0) + 1,
      refreshing: false,
      refreshPromise: null,
      pendingRestore: null,
      blocked: false,
      lastReason: ''
    };
    states.set(video, state);
    if (!boundVideos.has(video)) {
      boundVideos.add(video);
      video.addEventListener('loadedmetadata', () => {
        const liveState = states.get(video);
        if (!liveState) return;
        if (video.id === PLAYER_ID && window.__egybookBackgroundResumeV230?.hasSnapshot?.()) return;
        restoreAfterMetadata(video, liveState);
      }, { passive: true });
      video.addEventListener('error', () => {
        const liveState = states.get(video);
        if (!liveState || liveState.blocked || liveState.refreshing) return;
        refreshNow(video, 'media-error').catch(() => {});
      }, { passive: true });
      video.addEventListener('ended', () => {
        const liveState = states.get(video);
        if (liveState?.timer) { clearTimeout(liveState.timer); liveState.timer = 0; }
      }, { passive: true });
    }
    scheduleRefresh(video, state);
    if (descriptor.exp <= Math.floor(Date.now() / 1000) + 5) {
      refreshNow(video, 'expired-ticket').catch(() => {});
    }
    return state;
  }

  function attach(video) { return ensureState(video); }

  function scan(root = document) {
    if (root?.tagName === 'VIDEO') ensureState(root);
    root?.querySelectorAll?.('video').forEach(ensureState);
  }

  function captureSnapshots() {
    states.forEach((state, video) => {
      if (!video.isConnected || state.blocked) return;
      const current = inspectSource(readVideoSource(video));
      if (!current || current.identity !== state.identity) return;
      state.pendingRestore = createSnapshot(video, state.identity);
    });
  }

  function refreshDueSources() {
    scan(document);
    states.forEach((state, video) => {
      if (!video.isConnected || state.blocked || state.refreshing) return;
      const descriptor = inspectSource(readVideoSource(video));
      if (!descriptor || descriptor.identity !== state.identity) { stopTracking(video); return; }
      if (!descriptor.exp || descriptor.exp * 1000 - Date.now() <= REFRESH_LEAD_SECONDS * 1000) {
        refreshNow(video, 'resume-or-expiry-check').catch(() => {});
      } else if (!state.timer && !state.retryTimer) scheduleRefresh(video, state);
      if (state.pendingRestore && video.readyState >= 1) {
        if (!(video.id === PLAYER_ID && window.__egybookBackgroundResumeV230?.hasSnapshot?.())) {
          restoreAfterMetadata(video, state);
        }
      }
    });
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    scan(document);
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(records => {
        records.forEach(record => {
          if (record.type === 'attributes' && record.target?.tagName === 'VIDEO') {
            ensureState(record.target);
            return;
          }
          record.addedNodes?.forEach(node => scan(node));
          record.removedNodes?.forEach(node => {
            if (node?.tagName === 'VIDEO' && !node.isConnected) stopTracking(node);
            node?.querySelectorAll?.('video').forEach(video => { if (!video.isConnected) stopTracking(video); });
          });
        });
      });
      observer.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'data-feed-src']
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') captureSnapshots();
      else refreshDueSources();
    }, { passive: true });
    window.addEventListener('pagehide', captureSnapshots, { passive: true });
    window.addEventListener('pageshow', refreshDueSources, { passive: true });
    window.addEventListener('online', refreshDueSources, { passive: true });
  }

  function discardPendingRestore(video) {
    const state = video && states.get(video);
    if (!state || !state.pendingRestore) return false;
    state.pendingRestore = null;
    return true;
  }

  function dispose() {
    if (observer) observer.disconnect();
    observer = null;
    states.forEach(state => clearTimer(state));
    states.clear();
    renewalJobs.clear();
    initialized = false;
  }

  window.EgyBookVideoURLRenewalV231 = Object.freeze({
    version: 231,
    inspectSource,
    sameResource,
    attach,
    scan,
    refreshNow,
    refreshDueSources,
    discardPendingRestore,
    dispose,
    getTrackedCount: () => states.size
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
