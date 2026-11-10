/* EgyBook Reels-only network wait indicator. Does not observe Moments/audio. */
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

  const isVideoMode = () => modal.dataset.mediaKind === 'video' &&
    modal.classList.contains('open') && !modal.hidden;
  const hide = () => {
    clearTimeout(timer); timer = 0;
    indicator.classList.remove('is-visible');
    indicator.setAttribute('aria-hidden', 'true');
  };
  const showAfterDelay = () => {
    hide();
    if (!isVideoMode() || video.paused || video.ended) return;
    timer = window.setTimeout(() => {
      if (!isVideoMode() || video.paused || video.ended || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
      indicator.classList.add('is-visible');
      indicator.setAttribute('aria-hidden', 'false');
    }, 420);
  };

  video.addEventListener('waiting', showAfterDelay);
  video.addEventListener('stalled', showAfterDelay);
  video.addEventListener('playing', hide);
  video.addEventListener('canplay', hide);
  video.addEventListener('canplaythrough', hide);
  video.addEventListener('pause', hide);
  video.addEventListener('ended', hide);
  video.addEventListener('error', hide);
  video.addEventListener('emptied', hide);
  modal.addEventListener('egybook:evp-video-mode', () => {
    if (!isVideoMode()) hide();
  });
  const observer = new MutationObserver(() => { if (!isVideoMode()) hide(); });
  observer.observe(modal, { attributes: true, attributeFilter: ['class', 'hidden'] });
})();
