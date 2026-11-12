/* EgyBook v2020 interaction bridge.
   Keeps the existing media engine and delegated controls as the single playback authority. */
(() => {
  'use strict';
  const box = document.getElementById('egybookVideoBox');
  if (!box || box.dataset.v2020InteractionBound === '1') return;
  box.dataset.v2020InteractionBound = '1';

  const modal = document.getElementById('egybookVideoModal');
  const player = document.getElementById('egybookVideoPlayer');
  const poster = document.getElementById('egybookVideoPoster');
  const playButton = box.querySelector('.evp-play[data-evp="toggle"]');

  const interactive = target => !!target.closest(
    'button,input,select,textarea,label,a,[data-evp],.evp-post-rail,.evp-controls,.evp-top-actions,.evp-post-caption,.comments-modal,.evp-sound-modal,#evpReactionPicker'
  );
  const visibleMediaRect = () => {
    const active = player && !player.hidden ? player : poster;
    if (!active || active.hidden || getComputedStyle(active).display === 'none') return null;
    return active.getBoundingClientRect();
  };
  // Keep the exact legacy hit-test for non-video media so Moments/music
  // playback follows its previous path without behavior changes.
  const pointInsideMedia = (x, y) => {
    for (const media of [player, poster]) {
      if (!media || media.hidden || getComputedStyle(media).display === 'none') continue;
      const r = media.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  };

  // Video-only tap target: the play/pause control itself (with a forgiving
  // touch margin), plus one stable region immediately BELOW the center
  // controls. This is click-only: swipe-navigation.js keeps full ownership
  // of pointerdown/move/up and its vertical Push transition is not modified.
  const isVideoPlaybackTapPoint = (x, y) => {
    if (!playButton) return false;
    const surface = visibleMediaRect();
    if (!surface) return false;
    const control = playButton.getBoundingClientRect();
    const controlPadX = 22;
    const controlPadY = 18;
    const onControl = x >= control.left - controlPadX &&
      x <= control.right + controlPadX &&
      y >= control.top - controlPadY &&
      y <= control.bottom + controlPadY;
    if (onControl) return true;

    const zoneWidth = Math.min(surface.width * 0.78, 520);
    const zoneLeft = (surface.left + surface.right - zoneWidth) / 2;
    const zoneTop = control.bottom + 6;
    const zoneHeight = Math.max(112, Math.min(154, surface.height * 0.18));
    // Keep the target clear of the bottom progress bar, seek control and
    // system navigation area, including when the comments sheet reduces video.
    const zoneBottom = Math.min(surface.bottom - 76, zoneTop + zoneHeight);
    return zoneBottom > zoneTop && x >= zoneLeft && x <= zoneLeft + zoneWidth &&
      y >= zoneTop && y <= zoneBottom;
  };

  // Vertical media gestures are owned only by swipe-navigation.js.
  // This bridge handles taps and existing viewer controls, never navigation.

  // Any tap on the visible media surface delegates to the original player button.
  // This preserves the existing audio/video synchronization and control auto-hide logic.
  box.addEventListener('click', event => {
    if (interactive(event.target)) return;
    const swipeSuppressUntil = Number(box.dataset.evpSuppressSurfaceClickUntil || 0);
    if (Date.now() < swipeSuppressUntil) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (!pointInsideMedia(event.clientX, event.clientY) || !playButton) return;
    const isVideo = modal?.dataset.mediaKind === 'video';
    if (isVideo && !isVideoPlaybackTapPoint(event.clientX, event.clientY)) {
      // Prevent the older broad surface-tap handler from activating above the
      // requested lower playback area. Explicit playback buttons still work.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    playButton.click();
  }, true);

  // In the video comments drawer, a tap on the comment reaction control opens
  // the existing full reaction picker instead of applying only a thumbs-up.
  document.addEventListener('click', event => {
    const vote = event.target.closest('#commentsList .comment-vote[data-vote="like"]');
    const comments = document.getElementById('commentsModal');
    if (!vote || !comments?.classList.contains('evp-comments-overlay') || !comments.classList.contains('open')) return;
    const picker = document.getElementById('commentReactionPicker');
    const row = vote.closest('.egy-comment');
    if (!picker || !row) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const r = vote.getBoundingClientRect();
    const width = Math.min(320, innerWidth - 16);
    picker.style.maxWidth = width + 'px';
    picker.style.left = Math.max(8, Math.min(innerWidth - width - 8, r.left + (r.width - width) / 2)) + 'px';
    picker.style.top = Math.max(8, Math.min(innerHeight - 70, r.top - 66)) + 'px';
    picker.dataset.target = 'comment';
    picker.dataset.commentId = row.dataset.commentId || '';
    picker.hidden = false;
  }, true);
})();
