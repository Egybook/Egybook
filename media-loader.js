/* EgyBook Media Loader v1.0 — single source assignment and clip-start coordination. */
(function (w) {
  'use strict';
  if (w.EgyBookMediaLoader?.version === 1) return;

  function absoluteSource(value) {
    try { return new URL(String(value || ''), document.baseURI).href; }
    catch (_) { return String(value || ''); }
  }

  function assignSource(media, source, preload = 'auto') {
    if (!media || !source) return false;
    const next = absoluteSource(source);
    const current = absoluteSource(media.getAttribute('src') || media.currentSrc || media.src || '');
    media.preload = preload;
    if (current === next) return false;
    try { media.pause(); } catch (_) {}
    // Setting src already starts the browser's resource-selection algorithm.
    // Do not call load() afterwards: that can restart the same request/decoder.
    media.src = String(source);
    return true;
  }

  function playAudioClip(media, source, startAt = 0) {
    if (!media || !source) return Promise.reject(new Error('MEDIA_OR_SOURCE_MISSING'));
    const start = Math.max(0, Number(startAt) || 0);
    const sourceChanged = assignSource(media, source, 'auto');
    const token = (Number(media.dataset.egyMediaStartToken) || 0) + 1;
    media.dataset.egyMediaStartToken = String(token);
    let seekFinished = start <= 0.05;
    let resolveStart, rejectStart;
    const result = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    const current = () => media.dataset.egyMediaStartToken === String(token);
    const finish = () => {
      if (!current() || !seekFinished) return;
      media.muted = false;
      media.removeAttribute('muted');
      resolveStart(true);
    };
    const fail = error => { if (current()) rejectStart(error instanceof Error ? error : new Error(String(error || 'MEDIA_START_FAILED'))); };

    if (start > 0.05) {
      // Start muted in the originating gesture stack, then seek before audio is
      // made audible. This avoids exposing the unwanted beginning of a clip.
      media.muted = true;
      media.setAttribute('muted', '');
      const seek = () => {
        if (!current() || media.readyState < 1) return;
        const target = Number.isFinite(media.duration) && media.duration > 0
          ? Math.min(start, Math.max(0, media.duration - 0.1)) : start;
        if (Math.abs((media.currentTime || 0) - target) < 0.08) {
          seekFinished = true; finish(); return;
        }
        const onSeeked = () => {
          media.removeEventListener('seeked', onSeeked);
          if (!current()) return;
          seekFinished = true; finish();
        };
        media.addEventListener('seeked', onSeeked, { once: true });
        try { media.currentTime = target; }
        catch (error) { media.removeEventListener('seeked', onSeeked); fail(error); }
      };
      if (media.readyState >= 1) seek();
      else media.addEventListener('loadedmetadata', seek, { once: true });
    } else {
      media.muted = false;
      media.removeAttribute('muted');
    }

    let playResult;
    try { playResult = media.play(); }
    catch (error) { fail(error); return result; }
    if (playResult?.then) playResult.then(() => {
      if (start <= 0.05) finish();
    }).catch(fail);
    else if (start <= 0.05) finish();

    // If the source was already loaded, metadata may not fire again.
    if (!sourceChanged && start > 0.05 && media.readyState >= 1) {
      // seek() above has already been invoked synchronously.
    }
    return result;
  }

  w.EgyBookMediaLoader = Object.freeze({ version: 1, assignSource, playAudioClip });
})(window);
