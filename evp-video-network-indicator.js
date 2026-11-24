/* EgyBook Reels-only network wait indicator.
 * Shows for the initial source load only while no decoded data is available,
 * then for genuine buffering after playback has started. A decoded swipe cover
 * suppresses the redundant central spinner until that cover is removed. It
 * does not observe Moments/audio.
 */
(() => {
  'use strict';
  const modal = document.getElementById('egybookVideoModal');
  const box = document.getElementById('egybookVideoBox');
  const video = document.getElementById('egybookVideoPlayer');
  if (!modal || !box || !video || box.querySelector('.evp-video-network-wait')) return;

  const indicator = document.createElement('div');
  indicator.className = 'evp-video-network-wait';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-label', 'جارٍ تحميل الفيديو');
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<span class="evp-video-network-spinner" aria-hidden="true"></span>';
  box.append(indicator);

  let timer = 0;
  let loadToken = 0;
  let initialLoadPending = false;
  let playbackStarted = false;
  let bufferingPending = false;

  const hasReadySwipeCover = () => !!box.querySelector('.evp-swipe-preview[data-preview-ready="1"]');

  const isVideoMode = () => modal.dataset.mediaKind === 'video' &&
    modal.classList.contains('open') && !modal.hidden;
  const hide = () => {
    loadToken++;
    clearTimeout(timer); timer = 0;
    indicator.classList.remove('is-visible');
    indicator.setAttribute('aria-hidden', 'true');
  };
  const show = () => {
    if (!isVideoMode()) return;
    indicator.classList.add('is-visible');
    indicator.setAttribute('aria-hidden', 'false');
  };
  const scheduleInitialLoad = () => {
    clearTimeout(timer); timer = 0;
    if (!initialLoadPending || !isVideoMode() || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (hasReadySwipeCover()) { hide(); return; }
    const token = ++loadToken;
    timer = window.setTimeout(() => {
      if (token !== loadToken || !initialLoadPending || !isVideoMode()) return;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !video.error) show();
    }, 360);
  };
  const scheduleBuffering = () => {
    clearTimeout(timer); timer = 0;
    if (!playbackStarted || !isVideoMode() || video.paused || video.ended) return;
    if (hasReadySwipeCover()) { hide(); return; }
    const token = ++loadToken;
    timer = window.setTimeout(() => {
      if (token !== loadToken || !playbackStarted || !isVideoMode() || video.paused || video.ended) return;
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) show();
    }, 460);
  };
  const finishInitialLoad = () => {
    initialLoadPending = false;
    bufferingPending = false;
    hide();
  };

  video.addEventListener('loadstart', () => {
    loadToken++;
    playbackStarted = false;
    initialLoadPending = true;
    scheduleInitialLoad();
  });
  video.addEventListener('loadeddata', finishInitialLoad);
  video.addEventListener('canplay', finishInitialLoad);
  video.addEventListener('canplaythrough', finishInitialLoad);
  video.addEventListener('playing', () => {
    playbackStarted = true;
    bufferingPending = false;
    finishInitialLoad();
  });
  video.addEventListener('waiting', () => {
    if (playbackStarted) { bufferingPending = true; scheduleBuffering(); }
  });
  video.addEventListener('stalled', () => {
    if (playbackStarted) { bufferingPending = true; scheduleBuffering(); }
    else scheduleInitialLoad();
  });
  video.addEventListener('pause', () => {
    bufferingPending = false;
    if (!initialLoadPending) hide();
  });
  video.addEventListener('ended', () => {
    initialLoadPending = false;
    playbackStarted = false;
    bufferingPending = false;
    hide();
  });
  video.addEventListener('error', () => {
    initialLoadPending = false;
    bufferingPending = false;
    hide();
  });
  video.addEventListener('emptied', () => {
    initialLoadPending = false;
    playbackStarted = false;
    bufferingPending = false;
    hide();
  });
  modal.addEventListener('egybook:evp-video-mode', () => {
    if (!isVideoMode()) hide();
    else scheduleInitialLoad();
  });
  const refreshWaitState = () => {
    if (!isVideoMode()) { hide(); return; }
    if (hasReadySwipeCover()) { hide(); return; }
    if (initialLoadPending) scheduleInitialLoad();
    else if (bufferingPending) scheduleBuffering();
  };
  const modalObserver = new MutationObserver(refreshWaitState);
  modalObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'hidden'] });
  // The canonical player can still be loading while the already-decoded swipe
  // preview is visibly covering it. Re-evaluate when that cover becomes ready
  // or is removed, so a real wait can still be shown after visual continuity ends.
  const coverObserver = new MutationObserver(refreshWaitState);
  coverObserver.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-preview-ready'] });
})();
