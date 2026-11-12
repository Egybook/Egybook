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

  // Video-only playback hit target. The visible center button (and its touch
  // margin) remains a native button target; the large lower half of the video
  // surface is the secondary play/pause tap zone. All other video-area taps are
  // intentionally ignored so a tap above the controls cannot toggle playback.
  // The image/Moments path below keeps the original V17 behavior unchanged.
  const isVideoPlaybackTapPoint = (x, y) => {
    if (!playButton) return false;
    const surface = visibleMediaRect();
    if (!surface) return false;

    const control = playButton.getBoundingClientRect();
    const controlPadX = 24;
    const controlPadY = 22;
    const onCenterControl = x >= control.left - controlPadX &&
      x <= control.right + controlPadX &&
      y >= control.top - controlPadY &&
      y <= control.bottom + controlPadY;
    if (onCenterControl) return true;

    // A generously sized lower tap zone, anchored below the center controls
    // and ending above the progress/seek controls and Android navigation area.
    const zoneLeft = surface.left + surface.width * 0.14;
    const zoneRight = surface.right - surface.width * 0.08;
    const zoneTop = Math.max(control.bottom + 8, surface.top + surface.height * 0.53);
    const bottomClearance = Math.max(104, surface.height * 0.075);
    const zoneBottom = surface.bottom - bottomClearance;
    return zoneBottom > zoneTop && x >= zoneLeft && x <= zoneRight &&
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
    if (isVideo) {
      // Let the real playback/seek buttons pass through to the existing
      // document-level delegated player controls. Do not swallow their clicks.
      const explicitControl = event.target.closest(
        '.evp-center[data-evp="toggle"],.evp-skip[data-evp="back"],.evp-skip[data-evp="forward"],.evp-controls input,[data-evp]'
      );
      if (explicitControl || interactive(event.target)) return;

      if (!isVideoPlaybackTapPoint(event.clientX, event.clientY)) {
        // Stop only the legacy full-surface tap fallback. Pointer gestures for
        // vertical Push navigation are not touched by this click-only handler.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
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
