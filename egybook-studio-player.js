/* EgyBook Studio — EgyBook-branded media controls and custom choice menus. */
(() => {
  'use strict';
  if (window.EgyBookStudioPlayer) return;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const time = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const preview = $('#studioPreviewVideo');
  const stage = $('#studioPreviewStage');
  let expanded = false;

  function updatePreview() {
    if (!preview) return;
    const controls = $('#studioPreviewControls');
    const toggle = $('[data-studio-player="preview-toggle"]');
    const seek = $('#studioPreviewSeek');
    const current = $('#studioPreviewCurrent');
    const duration = $('#studioPreviewDuration');
    const mute = $('[data-studio-player="preview-mute"]');
    const hasMedia = !!preview.currentSrc || !!preview.getAttribute('src');
    if (controls) controls.hidden = !hasMedia || preview.hidden;
    if (toggle) {
      toggle.textContent = preview.paused ? '▶' : 'Ⅱ';
      toggle.setAttribute('aria-label', preview.paused ? 'تشغيل المعاينة' : 'إيقاف المعاينة');
    }
    if (seek && document.activeElement !== seek) {
      seek.value = String(Number.isFinite(preview.duration) && preview.duration > 0 ? Math.round((preview.currentTime / preview.duration) * 1000) : 0);
    }
    if (current) current.textContent = time(preview.currentTime);
    if (duration) duration.textContent = time(preview.duration);
    if (mute) {
      mute.textContent = preview.muted || preview.volume === 0 ? '◖̸' : '◖';
      mute.setAttribute('aria-label', preview.muted || preview.volume === 0 ? 'تشغيل الصوت' : 'كتم الصوت');
    }
  }

  function togglePreview() {
    if (!preview || preview.hidden) return;
    if (preview.paused) {
      preview.play().catch(error => window.EgyBookStudio?.status?.(error?.name === 'NotAllowedError' ? 'اضغط تشغيل مرة أخرى للسماح بمعاينة الفيديو.' : 'تعذر تشغيل معاينة الفيديو.', 'warn'));
    } else preview.pause();
    updatePreview();
  }

  function closeExpanded() {
    if (!expanded) return;
    expanded = false;
    stage?.classList.remove('is-expanded');
    document.body.classList.remove('studio-preview-expanded');
    const button = $('[data-studio-player="preview-expand"]');
    if (button) { button.textContent = '⛶'; button.setAttribute('aria-label', 'توسيع المعاينة'); }
  }

  function toggleExpanded() {
    if (!stage) return;
    expanded = !expanded;
    stage.classList.toggle('is-expanded', expanded);
    document.body.classList.toggle('studio-preview-expanded', expanded);
    const button = $('[data-studio-player="preview-expand"]');
    if (button) { button.textContent = expanded ? '×' : '⛶'; button.setAttribute('aria-label', expanded ? 'تصغير المعاينة' : 'توسيع المعاينة'); }
  }

  function bindPreview() {
    if (!preview) return;
    preview.controls = false;
    preview.removeAttribute('controls');
    preview.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
    preview.setAttribute('disablepictureinpicture', '');
    preview.setAttribute('disableremoteplayback', '');
    preview.disablePictureInPicture = true;
    preview.disableRemotePlayback = true;
    preview.playsInline = true;
    preview.setAttribute('playsinline', '');
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'seeking'].forEach(type => preview.addEventListener(type, updatePreview));
    preview.addEventListener('click', event => {
      if (event.target.closest('.studio-media-controls')) return;
      togglePreview();
    });
    preview.addEventListener('contextmenu', event => event.preventDefault());
    const seek = $('#studioPreviewSeek');
    seek?.addEventListener('input', () => {
      if (!Number.isFinite(preview.duration) || preview.duration <= 0) return;
      preview.currentTime = (Number(seek.value) / 1000) * preview.duration;
      updatePreview();
    });
    const stageObserver = new MutationObserver(() => {
      if (preview.hidden || (!preview.currentSrc && !preview.getAttribute('src'))) closeExpanded();
      updatePreview();
    });
    stageObserver.observe(preview, { attributes: true, attributeFilter: ['src', 'hidden'] });
    updatePreview();
  }


  document.addEventListener('click', event => {
    const action = event.target.closest('[data-studio-player]')?.dataset.studioPlayer;
    if (action === 'preview-toggle') togglePreview();
    if (action === 'preview-mute' && preview) { preview.muted = !preview.muted; updatePreview(); }
    if (action === 'preview-expand') toggleExpanded();
    if (action === 'audio-toggle') window.EgyBookStudioAudio?.togglePlayback?.();
    if (action && action.startsWith('preview-') && event.target.closest('button')) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  document.addEventListener('input', event => {
    if (event.target.id === 'studioAudioSeek') window.EgyBookStudioAudio?.seekFraction?.(event.target.value);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (expanded) { event.preventDefault(); closeExpanded(); }
    }
  }, true);
  document.addEventListener('egybook:studio-closed', closeExpanded);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPreview, { once: true });
  else bindPreview();

  window.EgyBookStudioPlayer = { refresh: updatePreview, closeExpanded };
})();
