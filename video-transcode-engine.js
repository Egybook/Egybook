/* EgyBook Smart Video Engine — client-side, best-effort transcoding.
 * The original upload remains authoritative. Transcoding is skipped on constrained devices.
 */
(function () {
  'use strict';
  if (window.EgyBookVideoTranscoder) return;
  const WORKER = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev';
  const FFMPEG_VERSION = '0.12.10';
  const CORE_VERSION = '0.12.6';
  let ffmpegPromise = null;
  const jobs = new Map();

  function canTranscode(file) {
    const memory = Number(navigator.deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    // FFmpeg.wasm keeps decoded frames and its virtual filesystem in memory.
    // Restrict this first rollout to desktop-class devices and modest inputs.
    return !!file && file.type?.startsWith('video/') && file.size <= 70 * 1024 * 1024 &&
      !mobile && memory >= 8 && cores >= 8 && !connection?.saveData &&
      !/^(slow-2g|2g)$/.test(connection?.effectiveType || '');
  }

  function getVideoMetadata(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const objectUrl = URL.createObjectURL(file);
      const done = (value) => { URL.revokeObjectURL(objectUrl); video.removeAttribute('src'); video.load(); resolve(value); };
      video.preload = 'metadata';
      video.onloadedmetadata = () => done({ width: video.videoWidth || 0, height: video.videoHeight || 0, duration: video.duration || 0 });
      video.onerror = () => done(null);
      video.src = objectUrl;
    });
  }

  async function loadFFmpeg() {
    if (ffmpegPromise) return ffmpegPromise;
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import(`https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`),
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js'),
      ]);
      const ffmpeg = new FFmpeg();
      const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
      const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((error) => { ffmpegPromise = null; throw error; });
    return ffmpegPromise;
  }

  function sourceKeyFromUrl(sourceUrl) {
    const url = new URL(sourceUrl, location.href);
    if (url.origin !== WORKER || !url.pathname.startsWith('/media/')) throw new Error('Unsupported original media URL');
    return decodeURIComponent(url.pathname.slice('/media/'.length));
  }

  async function saveManifest(sourceKey, variants, getToken) {
    const token = await getToken();
    const response = await fetch(`${WORKER}/media/variants/manifest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKey, variants }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Manifest save failed (${response.status})`);
    return body;
  }

  async function processAfterUpload({ file, originalUrl, userId, getToken, uploadVariant }) {
    if (!canTranscode(file)) return { skipped: true, reason: 'device-or-size-limit' };
    const key = sourceKeyFromUrl(originalUrl);
    if (jobs.has(key)) return jobs.get(key);
    const job = (async () => {
      const metadata = await getVideoMetadata(file);
      if (!metadata || !metadata.width || !metadata.height || metadata.duration > 180) return { skipped: true, reason: 'unsupported-video-profile' };
      const targets = [360, 480, 720].filter((height) => metadata.height > height);
      if (!targets.length) return { skipped: true, reason: 'source-already-low-resolution' };
      const ffmpeg = await loadFFmpeg();
      const inputName = `input-${Date.now()}.${(file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      const variants = [];
      try {
        for (const height of targets) {
          const outputName = `egybook-${height}.mp4`;
          await ffmpeg.exec([
            '-i', inputName, '-vf', `scale=-2:${height}:force_original_aspect_ratio=decrease`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '29',
            '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-threads', '1', outputName,
          ]);
          const data = await ffmpeg.readFile(outputName);
          const blob = new Blob([data], { type: 'video/mp4' });
          if (blob.size > 0 && blob.size < file.size) {
            const variantFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-${height}p.mp4`, { type: 'video/mp4', lastModified: Date.now() });
            const variantUrl = await uploadVariant(variantFile);
            const variantKey = decodeURIComponent(new URL(variantUrl).pathname.slice('/media/'.length));
            variants.push({ quality: height, key: variantKey });
          }
          await ffmpeg.deleteFile(outputName).catch(() => {});
        }
        if (variants.length) await saveManifest(key, variants, getToken);
        return { ready: variants.length > 0, variants };
      } finally {
        await ffmpeg.deleteFile(inputName).catch(() => {});
      }
    })().finally(() => jobs.delete(key));
    jobs.set(key, job);
    return job;
  }

  async function getManifest(sourceUrl) {
    const sourceKey = sourceKeyFromUrl(sourceUrl);
    const response = await fetch(`${WORKER}/media/variants/manifest?sourceKey=${encodeURIComponent(sourceKey)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Variant manifest unavailable (${response.status})`);
    return response.json();
  }

  function chooseVariant(manifest, quality) {
    const variants = Array.isArray(manifest?.variants) ? manifest.variants.slice().sort((a, b) => a.quality - b.quality) : [];
    if (!variants.length) return null;
    if (quality !== 'auto' && quality !== 'original') return variants.find((item) => Number(item.quality) === Number(quality)) || null;
    if (quality === 'original') return null;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const saveData = !!connection?.saveData || localStorage.getItem('egybook-data-saver') === 'on';
    const downlink = Number(connection?.downlink || 0);
    const target = saveData || /^(slow-2g|2g)$/.test(connection?.effectiveType || '') || (downlink > 0 && downlink < 1.5)
      ? 360 : (downlink > 0 && downlink < 4 ? 480 : 720);
    return variants.filter((item) => item.quality <= target).pop() || variants[0];
  }

  async function changeQuality(player, sourceUrl, quality) {
    if (!player || !sourceUrl) return false;
    if (quality === 'original') return switchSource(player, sourceUrl, sourceUrl);
    const manifest = await getManifest(sourceUrl);
    const variant = chooseVariant(manifest, quality);
    if (!variant) return quality === 'auto' ? switchSource(player, sourceUrl) : false;
    return switchSource(player, variant.url, sourceUrl);
  }

  function switchSource(player, nextUrl, fallbackUrl = '') {
    if (!player || !nextUrl || player.currentSrc === nextUrl || player.src === nextUrl) return Promise.resolve(true);
    const previousUrl = player.currentSrc || player.src || fallbackUrl;
    const time = Number.isFinite(player.currentTime) ? player.currentTime : 0;
    const wasPlaying = !player.paused && !player.ended;
    const volume = player.volume, muted = player.muted, rate = player.playbackRate;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (success) => {
        if (settled) return; settled = true;
        player.removeEventListener('loadedmetadata', onMeta);
        player.removeEventListener('error', onError);
        if (!success && fallbackUrl && player.src !== fallbackUrl) {
          player.src = fallbackUrl;
          player.load();
          player.addEventListener('loadedmetadata', () => {
            try { if (time > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(time, Math.max(0, player.duration - 0.15)); } catch (_) {}
            player.volume = volume; player.muted = muted; player.playbackRate = rate;
            if (wasPlaying) player.play().catch(() => {});
          }, { once: true });
          resolve(false); return;
        }
        try { if (time > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(time, Math.max(0, player.duration - 0.15)); } catch (_) {}
        player.volume = volume; player.muted = muted; player.playbackRate = rate;
        if (wasPlaying) player.play().catch(() => {});
        resolve(success);
      };
      const onMeta = () => finish(true);
      const onError = () => finish(false);
      player.addEventListener('loadedmetadata', onMeta, { once: true });
      player.addEventListener('error', onError, { once: true });
      player.src = nextUrl; player.load();
      setTimeout(() => { if (!settled) finish(false); }, 8000);
    });
  }

  async function applyPlaybackQuality(player, sourceUrl) {
    const quality = localStorage.getItem('egybook-player-quality') || 'auto';
    if (quality === 'original') return false;
    const manifest = await getManifest(sourceUrl);
    const variant = chooseVariant(manifest, quality);
    if (!variant) return false;
    return switchSource(player, variant.url, sourceUrl);
  }

  window.EgyBookVideoTranscoder = { processAfterUpload, getManifest, changeQuality, applyPlaybackQuality, canTranscode };
})();
