/* EgyBook Reels — intrinsic media dimension classifier.
 * Reads actual decoded dimensions; never infers orientation from file names.
 * It only adds presentation classes/data attributes and does not own playback.
 */
(() => {
  'use strict';
  const ratioGroups = [
    ['1:1', 1], ['4:5', 4/5], ['3:4', 3/4], ['2:3', 2/3], ['9:16', 9/16],
    ['4:3', 4/3], ['3:2', 3/2], ['16:9', 16/9], ['21:9', 21/9], ['32:9', 32/9]
  ];
  const closestRatio = ratio => ratioGroups.reduce((best, item) =>
    Math.abs(Math.log(ratio / item[1])) < Math.abs(Math.log(ratio / best[1])) ? item : best, ratioGroups[0]);

  function classify(media) {
    if (!media) return;
    const width = media.videoWidth || media.naturalWidth || 0;
    const height = media.videoHeight || media.naturalHeight || 0;
    if (!width || !height) return;
    const ratio = width / height;
    const [name, standard] = closestRatio(ratio);
    const close = Math.abs(Math.log(ratio / standard)) <= 0.055;
    media.dataset.egybookAspect = close ? name : 'custom';
    media.dataset.egybookRatio = ratio.toFixed(5);
    const box = media.closest('#egybookVideoBox');
    if (box) {
      box.classList.toggle('evp-top-start', ratio <= 0.75);
      box.classList.toggle('evp-natural-stage', ratio > 0.75);
      box.dataset.mediaAspect = close ? name : 'custom';
    }
    if (media.matches('.post video, video.post-image')) {
      media.classList.toggle('egybook-feed-tall-video', ratio <= 0.75);
      media.classList.toggle('egybook-feed-natural-video', ratio > 0.75);
    }
  }

  function watch(media) {
    if (!(media instanceof HTMLMediaElement) || media.dataset.egybookDimensionsWatch === '1') return;
    media.dataset.egybookDimensionsWatch = '1';
    ['loadedmetadata', 'loadeddata', 'resize'].forEach(type => media.addEventListener(type, () => classify(media), { passive: true }));
    if (media.readyState >= 1) classify(media);
  }
  function scan(scope = document) {
    if (scope.matches?.('video,img')) watch(scope);
    scope.querySelectorAll?.('video,img').forEach(watch);
  }
  scan();
  const observer = new MutationObserver(records => records.forEach(record => {
    if (record.type === 'childList') record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); });
    else if (record.target instanceof HTMLMediaElement) classify(record.target);
  }));
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  window.addEventListener('egybook:evp-post-context', () => {
    const player = document.getElementById('egybookVideoPlayer');
    if (player) classify(player);
  });
  window.EgyBookReelsDimensions = Object.freeze({ classify, closestRatio: ratio => closestRatio(ratio)[0] });
})();
