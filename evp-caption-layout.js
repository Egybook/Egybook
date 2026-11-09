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

  // Media sizing belongs exclusively to media-display-manager.js.
  // This module intentionally owns captions only.

})();
