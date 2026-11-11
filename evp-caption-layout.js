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
    caption.innerHTML = '<p class="evp-post-caption-text"></p><button type="button" class="evp-post-caption-more" hidden aria-expanded="false">المزيد</button><button type="button" class="evp-last-comment" id="evpLastComment" hidden><span class="evp-last-comment-avatar"></span><span class="evp-last-comment-copy"><strong class="evp-last-comment-name"></strong><span class="evp-last-comment-text"></span><small class="evp-last-comment-hint">عرض كل التعليقات</small></span></button>';
    box.append(caption);
  }

  const textNode = caption.querySelector('.evp-post-caption-text');
  const moreButton = caption.querySelector('.evp-post-caption-more');
  let lastComment = caption.querySelector('#evpLastComment');
  if (!lastComment) {
    lastComment = document.createElement('button');
    lastComment.type = 'button'; lastComment.id = 'evpLastComment';
    lastComment.className = 'evp-last-comment'; lastComment.hidden = true;
    lastComment.innerHTML = '<span class="evp-last-comment-avatar"></span><span class="evp-last-comment-copy"><strong class="evp-last-comment-name"></strong><span class="evp-last-comment-text"></span><small class="evp-last-comment-hint">عرض كل التعليقات</small></span>';
    caption.append(lastComment);
  }
  let activePost = null;
  lastComment.addEventListener('click', () => {
    if (!activePost) return;
    window.dispatchEvent(new CustomEvent('egybook:evp-open-comments', { detail: { post: activePost } }));
  });
  window.addEventListener('egybook:evp-last-comment', event => {
    const detail = event.detail || {};
    if (!activePost || String(detail.postId || '') !== String(activePost.dataset.postId || '')) return;
    lastComment.hidden = !detail.comment;
    if (detail.comment) caption.hidden = false;
    else caption.hidden = !String(textNode?.textContent || '').trim();
    if (!detail.comment) return;
    const avatar = lastComment.querySelector('.evp-last-comment-avatar');
    const name = lastComment.querySelector('.evp-last-comment-name');
    const text = lastComment.querySelector('.evp-last-comment-text');
    if (avatar) { avatar.style.backgroundImage = detail.comment.avatar ? `url("${String(detail.comment.avatar).replace(/"/g, '%22')}")` : ''; }
    if (name) name.textContent = detail.comment.name || 'عضو EgyBook';
    if (text) text.textContent = detail.comment.text || 'أضاف تعليقًا';
  });
  const setCaption = post => {
    activePost = post || null;
    lastComment.hidden = true;
    const source = post?.querySelector('.post-text');
    const text = String(source?.textContent || '').trim();
    caption.hidden = !text && lastComment.hidden;
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
