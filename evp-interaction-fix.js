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

  const interactive = (target, isVideo) => {
    // For Moments/music-photo media preserve the previous full rail exclusion.
    // For videos, ignore only actual controls; empty rail space must behave as
    // part of the video surface so it can receive the normal play/pause tap.
    const common = 'button,input,select,textarea,label,a,[data-evp],.evp-controls,.evp-top-actions,.evp-post-caption,.comments-modal,.evp-sound-modal,#evpReactionPicker';
    const videoControls = `${common},.evp-settings-backdrop`;
    return !!target?.closest?.(isVideo ? videoControls : `${common},.evp-post-rail`);
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

  // Vertical media gestures are owned only by swipe-navigation.js.
  // This bridge handles taps and existing viewer controls, never navigation.

  // Any tap on the visible media surface delegates to the original player button.
  // This preserves the existing audio/video synchronization and control auto-hide logic.
  box.addEventListener('click', event => {
    const isVideo = modal?.dataset.mediaKind === 'video';
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (interactive(target, isVideo)) return;

    // A completed vertical swipe must never be reinterpreted as a playback tap.
    // This reads the existing suppression flag set by swipe-navigation.js;
    // the swipe engine itself is deliberately not modified.
    const swipeSuppressUntil = Number(box.dataset.evpSuppressSurfaceClickUntil || 0);
    if (Date.now() < swipeSuppressUntil) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (!pointInsideMedia(event.clientX, event.clientY) || !playButton) return;

    if (isVideo) {
      // Real controls keep their native/delegated click path. All other taps
      // on the video surface (upper, center, or lower area) use the existing
      // player toggle button so playback state and chrome visibility stay in
      // sync with the original video engine.
      const explicitControl = target?.closest?.(
        '.evp-center[data-evp="toggle"],.evp-skip[data-evp="back"],.evp-skip[data-evp="forward"],.evp-controls input,[data-evp],.evp-audio-settings-controls'
      );
      if (explicitControl) return;
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
