/* EgyBook video viewer: caption layout and portrait-stage presentation.
   This module only decorates the existing viewer; it does not control media playback. */
(() => {
  'use strict';
  const modal = document.getElementById('egybookVideoModal');
  const box = document.getElementById('egybookVideoBox');
  if (!modal || !box) return;

  const player = document.getElementById('egybookVideoPlayer');
  const poster = document.getElementById('egybookVideoPoster');
  let caption = document.getElementById('evpPostCaption');
  if (!caption) {
    caption = document.createElement('section');
    caption.id = 'evpPostCaption';
    caption.className = 'evp-post-caption';
    caption.dir = 'auto';
    caption.hidden = true;
    caption.innerHTML = '<p class="evp-post-caption-text"></p><button type="button" class="evp-post-caption-more" hidden aria-expanded="false">المزيد</button>';
    box.append(caption);
  }

  const textNode = caption.querySelector('.evp-post-caption-text');
  const moreButton = caption.querySelector('.evp-post-caption-more');
  const setCaption = post => {
    const source = post?.querySelector('.post-text');
    const text = String(source?.textContent || '').trim();
    caption.hidden = !text;
    caption.classList.remove('is-expanded');
    textNode.textContent = text;
    const needsMore = text.length > 105 || text.split(/\s+/).length > 18;
    moreButton.hidden = !needsMore;
    moreButton.textContent = 'المزيد';
    moreButton.setAttribute('aria-expanded', 'false');
  };

  // The main player announces the active post; this module owns caption UI only.
  window.addEventListener('egybook:evp-post-context', event => {
    setCaption(event.detail?.post || null);
  });

  moreButton.addEventListener('click', () => {
    const expanded = caption.classList.toggle('is-expanded');
    moreButton.textContent = expanded ? 'عرض أقل' : 'المزيد';
    moreButton.setAttribute('aria-expanded', String(expanded));
  });

  const updatePortraitStage = () => {
    // Video-stage position is controlled exclusively by script.js from the
    // incoming video metadata. This observer remains for photo+music only.
    if (modal.dataset.mediaKind === 'video') return;
    let width = 0, height = 0;
    if (poster && !poster.hidden && poster.naturalWidth && poster.naturalHeight) {
      width = poster.naturalWidth;
      height = poster.naturalHeight;
    } else if (player && player.videoWidth && player.videoHeight) {
      width = player.videoWidth;
      height = player.videoHeight;
    }
    box.classList.toggle('evp-portrait-stage', !!(width && height && height / width > 1.18));
  };
  player?.addEventListener('loadedmetadata', updatePortraitStage);
  poster?.addEventListener('load', updatePortraitStage);
  const observer = new MutationObserver(updatePortraitStage);
  if (player) observer.observe(player, { attributes: true, attributeFilter: ['src', 'hidden'] });
  if (poster) observer.observe(poster, { attributes: true, attributeFilter: ['src', 'hidden'] });
  modal.addEventListener('transitionend', updatePortraitStage);
})();
