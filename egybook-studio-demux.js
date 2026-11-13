/* EgyBook Studio — local, on-demand extraction of the original audio stream. */
(() => {
  'use strict';
  if (window.EgyBookStudioDemux) return;
  const FFMPEG_VERSION = '0.12.10';
  const CORE_VERSION = '0.12.6';
  let activeJob = null;

  function makeSafeExtension(name, fallback = 'mp4') {
    const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
    return (match?.[1] || fallback).toLowerCase();
  }

  async function loadEngine(onProgress) {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import(`https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js')
    ]);
    const ffmpeg = new FFmpeg();
    try {
      const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;
      const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
      if (onProgress) ffmpeg.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(1, Number(progress) || 0))));
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    } catch (error) {
      try { ffmpeg.terminate(); } catch (_) {}
      throw error;
    }
  }

  async function extract({ file = null, url = '', name = '', onProgress = null } = {}) {
    if (activeJob) throw new Error('EXTRACTION_IN_PROGRESS');
    activeJob = true;
    let ffmpeg = null;
    let inputName = '', outputName = '';
    try {
      let sourceFile = file;
      if (!sourceFile && url) {
        if (!/^https:\/\//i.test(url)) throw new Error('INVALID_SOURCE_URL');
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok || response.type === 'opaque') throw new Error('SOURCE_DOWNLOAD_FAILED');
        const blob = await response.blob();
        sourceFile = new File([blob], name || 'egybook-source-video.mp4', { type: blob.type || 'video/mp4' });
      }
      if (!sourceFile || !sourceFile.size) throw new Error('EMPTY_SOURCE');
      const memory = Number(navigator.deviceMemory || 4);
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
      const maxBytes = memory <= 2 ? 35 * 1024 * 1024 : memory <= 4 ? 75 * 1024 * 1024 : 140 * 1024 * 1024;
      if (sourceFile.size > maxBytes) throw new Error('SOURCE_TOO_LARGE');
      if (mobile && sourceFile.size > 75 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE');

      ffmpeg = await loadEngine(onProgress);
      inputName = `egybook-input-${Date.now()}.${makeSafeExtension(sourceFile.name)}`;
      outputName = `egybook-audio-${Date.now()}.m4a`;
      await ffmpeg.writeFile(inputName, new Uint8Array(await sourceFile.arrayBuffer()));
      const code = await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:a:0',
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-threads', '1',
        outputName
      ]);
      if (Number(code) !== 0) throw new Error('NO_EXTRACTABLE_AUDIO');
      const output = await ffmpeg.readFile(outputName);
      if (!output?.length) throw new Error('EMPTY_AUDIO_OUTPUT');
      return new File([output], `EgyBook-Audio-${Date.now()}.m4a`, { type: 'audio/mp4', lastModified: Date.now() });
    } catch (error) {
      if (/fetch|network|cors/i.test(String(error?.message || error))) throw new Error('SOURCE_DOWNLOAD_FAILED');
      throw error;
    } finally {
      if (ffmpeg) {
        if (inputName) await ffmpeg.deleteFile(inputName).catch(() => {});
        if (outputName) await ffmpeg.deleteFile(outputName).catch(() => {});
        try { ffmpeg.terminate(); } catch (_) {}
      }
      activeJob = false;
    }
  }

  window.EgyBookStudioDemux = { extract, isBusy: () => !!activeJob };
})();
