/* EgyBook Image Player module v2008.
 * Small isolated interaction layer; legacy rendering/actions remain in script.js
 * to preserve the existing application closure and all feature dependencies.
 */
(function (w) {
  'use strict';
  if (w.EgyBookImagePlayer) return;
  const MUSIC_POST = post => !!(post && (post.dataset.musicTrackId || post.dataset.audioSourcePostId || post.querySelector('[data-post-music-player]')));
  function sequenceScope(post) {
    const profile = document.getElementById('profilePage');
    const profileList = document.getElementById('profilePostsList');
    const homeList = document.getElementById('postsList');
    if (profile && !profile.hidden && profileList && profileList.contains(post)) return profileList;
    if (homeList && homeList.contains(post)) return homeList;
    return post?.parentElement || null;
  }
  function isMusicPost(post) { return MUSIC_POST(post); }
  function collectMusicPosts(post) {
    const scope = sequenceScope(post);
    if (!scope) return [post].filter(Boolean);
    const rows = [...scope.querySelectorAll('.post')].filter(MUSIC_POST);
    if (MUSIC_POST(post) && !rows.includes(post)) rows.push(post);
    return rows;
  }
  function classifySwipe(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 55) return null;
    if (ay > ax * 1.15) return dy < 0 ? 'next' : 'previous';
    if (ax > ay * 1.2) return dx < 0 ? 'next' : 'previous';
    return null;
  }
  w.EgyBookImagePlayer = Object.freeze({ isMusicPost, collectMusicPosts, classifySwipe });
})(window);
