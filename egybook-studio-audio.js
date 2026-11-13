/* EgyBook Studio — independent audio tracks from files, Reels sources and Voice Over. */
(() => {
  'use strict';
  if (window.EgyBookStudioAudio) return;

  let voiceStream = null, voiceRecorder = null, voiceChunks = [];
  const audioUrls = new Set();
  let activeTrackId = null;
  let activeElement = null;
  let activeTrack = null;
  let recordingMixCount = 0;
  let mixContext = null, mixDestination = null, mixMusicGain = null;
  const mediaGraphNodes = new WeakMap();
  const $ = selector => document.querySelector(selector);
  const status = (message, kind = 'info') => window.EgyBookStudio?.status(message, kind);
  const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const formatTime = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  function makeUrl(file) {
    const url = URL.createObjectURL(file);
    audioUrls.add(url);
    return url;
  }

  function stopCurrent({ clearSource = false } = {}) {
    if (activeElement) {
      try { activeElement.pause(); } catch (_) {}
      if (clearSource) {
        try { activeElement.removeAttribute('src'); activeElement.load(); } catch (_) {}
      }
    }
    activeElement = null;
    activeTrack = null;
    activeTrackId = null;
    updatePlayerUI();
  }

  function getTrackElement(track) {
    return track?.sourceMediaType === 'video' ? $('#studioSourceAudioVideo') : $('#studioAudioPreview');
  }

  function trackUrl(track) {
    if (!track) return '';
    if (track.url) return track.url;
    if (track.file) {
      track.url = makeUrl(track.file);
      return track.url;
    }
    return track.mediaUrl || '';
  }

  function durationFor(track, element = activeElement) {
    const natural = Number(element?.duration);
    if (Number.isFinite(natural) && natural > 0) return natural;
    const stored = Number(track?.duration || track?.mediaDuration || 0);
    return Number.isFinite(stored) ? stored : 0;
  }

  function trimBounds(track, element = activeElement) {
    const duration = durationFor(track, element);
    const start = Math.max(0, Number(track?.trimStart ?? track?.sourceStart ?? 0) || 0);
    const rawEnd = Number(track?.trimEnd ?? track?.sourceEnd ?? duration);
    const end = Number.isFinite(rawEnd) && rawEnd > start ? Math.min(duration || rawEnd, rawEnd) : duration;
    return { start, end: Math.max(start, end), duration };
  }

  function updatePlayerUI() {
    const panel = $('#studioAudioPlayer');
    const play = $('[data-studio-player="audio-toggle"]');
    const seek = $('#studioAudioSeek');
    const current = $('#studioAudioCurrent');
    const duration = $('#studioAudioDuration');
    const title = $('#studioAudioPlayerTitle');
    const meta = $('#studioAudioPlayerMeta');
    const volume = $('#studioAudioVolume');
    if (!panel) return;
    const track = activeTrack;
    const element = activeElement;
    panel.hidden = !track || !element;
    if (!track || !element) return;
    const bounds = trimBounds(track, element);
    const currentTime = Math.max(0, Number(element.currentTime) || bounds.start);
    const elapsed = Math.max(0, currentTime - bounds.start);
    const length = Math.max(0, bounds.end - bounds.start);
    if (play) {
      play.textContent = element.paused ? '▶' : 'Ⅱ';
      play.setAttribute('aria-label', element.paused ? 'تشغيل الصوت' : 'إيقاف الصوت');
    }
    if (seek && document.activeElement !== seek) seek.value = String(length > 0 ? Math.round(Math.max(0, Math.min(1, elapsed / length)) * 1000) : 0);
    if (current) current.textContent = formatTime(elapsed);
    if (duration) duration.textContent = formatTime(length || bounds.duration);
    if (title) title.textContent = track.name || 'مسار صوتي';
    if (meta) meta.textContent = track.kind === 'egybook-source' ? 'صوت مرتبط من Reels على EgyBook' : track.kind === 'extracted' ? 'الصوت الأصلي للفيديو · مسار مستقل' : track.kind === 'voice' ? 'تعليق صوتي مسجل' : 'ملف صوتي';
    if (volume && document.activeElement !== volume) volume.value = String(Math.round((Number(element.volume) || 0) * 100));
  }

  function attachPlaybackEvents(element) {
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'seeking'].forEach(type => {
      element.addEventListener(type, () => {
        if (element !== activeElement) return;
        const bounds = trimBounds(activeTrack, element);
        if (type === 'timeupdate' && bounds.end > bounds.start && element.currentTime >= bounds.end - 0.035) {
          if (recordingMixCount > 0) {
            try { element.currentTime = bounds.start; const replay = element.play(); replay?.catch?.(() => {}); } catch (_) {}
          } else {
            element.pause();
            try { element.currentTime = bounds.start; } catch (_) {}
          }
        }
        updatePlayerUI();
      });
    });
  }

  async function selectTrack(track, { autoplay = false } = {}) {
    if (!track) return false;
    const element = getTrackElement(track);
    if (!element) { status('مشغل الصوت غير متاح داخل الاستوديو.', 'error'); return false; }
    const src = trackUrl(track);
    if (!src) { status('مصدر الصوت غير متاح أو لم يعد صالحًا.', 'warn'); return false; }
    stopCurrent();
    const other = element === $('#studioAudioPreview') ? $('#studioSourceAudioVideo') : $('#studioAudioPreview');
    if (other) { try { other.pause(); other.removeAttribute('src'); other.load(); } catch (_) {} }
    activeTrack = track;
    activeTrackId = track.id;
    activeElement = element;
    document.dispatchEvent(new Event('egybook:studio-panel-changed'));
    element.controls = false;
    element.crossOrigin = 'anonymous';
    element.loop = false;
    element.preload = 'metadata';
    element.playsInline = true;
    element.volume = Math.max(0, Math.min(1, Number(track.volume ?? 1)));
    element.onerror = () => {
      // Some external media hosts do not send CORS headers. Retry plain playback
      // so preview remains usable; Web Audio capture may then fall back to mic-only.
      if (element.crossOrigin === 'anonymous' && !track.__egybookCorsRetry) {
        track.__egybookCorsRetry = true;
        element.removeAttribute('crossorigin');
        element.src = src;
        element.load();
        status('المصدر لا يسمح بدمج الصوت عبر CORS؛ تمت إعادة محاولة تشغيله للمعاينة العادية.', 'warn');
      }
    };
    element.src = src;
    element.load();
    element.onloadedmetadata = () => {
      if (activeElement !== element || activeTrack !== track) return;
      const bounds = trimBounds(track, element);
      const startControl = $('#studioAudioTrim'), endControl = $('#studioAudioTrimEnd');
      if (startControl) { startControl.max = String(Math.max(0.1, bounds.duration || bounds.end || 100)); startControl.value = String(bounds.start); }
      if (endControl) { endControl.max = String(Math.max(0.1, bounds.duration || bounds.end || 100)); endControl.value = String(bounds.end || bounds.duration); }
      if (Number.isFinite(bounds.start) && bounds.start > 0) { try { element.currentTime = bounds.start; } catch (_) {} }
      updatePlayerUI();
    };
    updatePlayerUI();
    renderTracks();
    if (autoplay) {
      try { await element.play(); }
      catch (error) {
        status(error?.name === 'NotAllowedError' ? 'اضغط تشغيل للسماح بسماع المسار على هاتفك.' : 'تعذر تشغيل هذا الصوت من المصدر حاليًا.', 'warn');
        return false;
      }
    }
    return true;
  }

  function renderTracks() {
    const list = $('#studioAudioTracksList');
    if (!list) return;
    const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
    list.replaceChildren();
    if (!tracks.length) {
      const empty = document.createElement('p');
      empty.className = 'studio-empty';
      empty.textContent = 'لا توجد مسارات صوتية.';
      list.append(empty);
      return;
    }
    tracks.forEach(track => {
      const row = document.createElement('div');
      row.className = `studio-audio-track${track.id === activeTrackId ? ' is-active' : ''}`;
      const icon = document.createElement('span');
      icon.className = 'studio-audio-track-icon';
      icon.textContent = track.kind === 'voice' ? '🎙' : track.kind === 'egybook-source' ? '♫' : track.kind === 'extracted' ? '◖' : '♪';
      const copy = document.createElement('span');
      copy.className = 'studio-audio-track-copy';
      const title = document.createElement('strong');
      title.textContent = track.name || 'مسار صوتي';
      const detail = document.createElement('small');
      detail.textContent = track.kind === 'egybook-source' ? 'صوت من Reels على EgyBook' : track.kind === 'voice' ? 'تعليق صوتي' : track.kind === 'extracted' ? 'الصوت الأصلي للفيديو المحدد' : 'ملف صوتي محلي';
      copy.append(title, detail);
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'studio-audio-track-action';
      play.dataset.audioTrackPlay = track.id;
      play.textContent = track.id === activeTrackId && activeElement && !activeElement.paused ? 'Ⅱ' : 'استمع';
      play.setAttribute('aria-label', `تشغيل ${track.name || 'المسار الصوتي'}`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'studio-audio-track-remove';
      remove.dataset.audioTrackRemove = track.id;
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'حذف المسار الصوتي');
      row.append(icon, copy, play, remove);
      list.append(row);
    });
  }

  async function renderWave(file) {
    const canvas = $('#studioAudioWaveform');
    if (!canvas || !file || !String(file.type || '').startsWith('audio/')) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const audioContext = new AC();
    try {
      const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      const data = buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / canvas.width));
      context.fillStyle = '#21d7ff';
      for (let x = 0; x < canvas.width; x++) {
        let peak = 0;
        for (let i = 0; i < step; i++) peak = Math.max(peak, Math.abs(data[x * step + i] || 0));
        const height = Math.max(2, peak * canvas.height * .9);
        context.fillRect(x, (canvas.height - height) / 2, 2, height);
      }
    } catch (_) {
      status('تمت إضافة الصوت. معاينة الموجة غير متاحة لهذا الترميز، لكن تشغيل المسار يظل ممكنًا.', 'info');
    } finally {
      await audioContext.close().catch(() => {});
    }
  }

  function addTrack(track, { select = true, message = '' } = {}) {
    if (!track.id) track.id = makeId('audio');
    const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
    if (tracks.some(item => item.id === track.id)) {
      const existing = tracks.find(item => item.id === track.id);
      if (select) void selectTrack(existing);
      return existing;
    }
    window.EgyBookStudioEditor?.addAudioTrack(track);
    if (track.file && !track.url) track.url = makeUrl(track.file);
    renderTracks();
    if (select) void selectTrack(track);
    if (track.file && String(track.file.type || '').startsWith('audio/')) renderWave(track.file).catch(() => {});
    if (message) status(message);
    return track;
  }

  function trackFile(file, kind = 'music') {
    const url = makeUrl(file);
    const track = {
      id: makeId('audio'), name: file.name || (kind === 'voice' ? 'تعليق صوتي' : 'مسار صوتي'),
      file, type: file.type, kind, sourceMediaType: 'audio', url, volume: 1, trimStart: 0
    };
    addTrack(track, { select: true, message: kind === 'voice' ? 'تمت إضافة التعليق الصوتي إلى المشروع.' : 'تمت إضافة المسار الصوتي إلى المشروع.' });
    const title = $('#studioLocalAudioName');
    if (title) title.textContent = track.name;
    return track;
  }

  function addSource(sound) {
    const title = $('#studioSoundSourceTitle');
    const artist = $('#studioSoundSourceArtist');
    const card = $('#studioSoundSourceCard');
    if (title && sound?.title) title.textContent = sound.title;
    if (artist) artist.textContent = sound?.artist || 'صوت أصلي من EgyBook';
    if (card) card.hidden = !sound;
    const reelExtractButton = $('#studioExtractReelSoundButton');
    if (reelExtractButton) reelExtractButton.hidden = !sound;
    if (!sound) return null;

    let mediaUrl = sound.mediaUrl || '';
    let sourceMediaType = mediaUrl ? 'video' : 'audio';
    if (!mediaUrl && sound.trackId) {
      mediaUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(sound.trackId)}/stream`;
      sourceMediaType = 'audio';
    }
    const id = `source-${sound.sourcePostId || sound.trackId || 'sound'}`;
    const track = {
      id, name: sound.title || 'صوت من Reels على EgyBook', kind: 'egybook-source',
      sourcePostId: sound.sourcePostId || '', trackId: sound.trackId || '',
      mediaUrl, sourceMediaType, artist: sound.artist || '', artwork: sound.artwork || '',
      permalink: sound.permalink || '', volume: 1, trimStart: 0
    };
    const result = addTrack(track, { select: true, message: 'تم ربط مصدر الصوت من Reels بالمشروع. يمكنك معاينته أو استخراج نسخة صوتية مستقلة.' });
    renderTracks();
    return result;
  }

  let extractionInProgress = false;
  async function addExtractedVideoAudio(origin = 'clip') {
    if (extractionInProgress) {
      status('جارٍ تجهيز الصوت بالفعل. انتظر انتهاء العملية.', 'warn');
      return false;
    }
    const button = $(origin === 'reel' ? '#studioExtractReelSoundButton' : '#studioExtractSoundButton');
    const originalLabel = button?.textContent || 'استخراج الصوت الأصلي';
    const sourceSound = window.EgyBookStudioEditor?.getSourceSound?.();
    const clip = window.EgyBookStudioEditor?.getSelected?.();
    let source = null;
    let sourceName = 'الفيديو المحدد';
    let sourceMeta = {};

    // Reel extraction is explicit and separate from the selected local timeline clip.
    if (origin === 'reel' && sourceSound?.mediaUrl) {
      source = { url: sourceSound.mediaUrl, name: sourceSound.title || 'EgyBook-Reel-source.mp4' };
      sourceName = sourceSound.title || 'صوت من Reels';
      sourceMeta = { sourcePostId: sourceSound.sourcePostId || '', trackId: sourceSound.trackId || '', permalink: sourceSound.permalink || '' };
    } else if (origin === 'reel' && sourceSound?.trackId) {
      source = { url: `https://api.audius.co/v1/tracks/${encodeURIComponent(sourceSound.trackId)}/stream`, name: `${sourceSound.title || 'EgyBook-Audio'}.mp3` };
      sourceName = sourceSound.title || 'صوت من Reels';
      sourceMeta = { trackId: sourceSound.trackId, permalink: sourceSound.permalink || '' };
    } else if (origin === 'clip' && clip?.kind === 'video' && clip.file) {
      source = { file: clip.file, name: clip.file.name || clip.name || 'EgyBook-Video.mp4' };
      sourceName = clip.name || clip.file.name || 'الفيديو المحدد';
      sourceMeta = {
        sourceClipId: clip.id,
        sourceStart: Math.max(0, Number(clip.in) || 0),
        sourceEnd: Math.max(0, Number(clip.out) || Number(clip.duration) || 0),
        duration: Number(clip.duration) || 0
      };
    }

    if (!source) {
      status(origin === 'reel' ? 'مصدر صوت الـ Reel غير متاح للاستخراج.' : 'اختار فيديو من خط الزمن أولًا لاستخراج صوته الأصلي.', 'warn');
      return false;
    }
    if (!window.EgyBookStudioDemux?.extract) {
      status('أداة استخراج الصوت غير جاهزة. حدّث الصفحة ثم جرّب مرة أخرى.', 'error');
      return false;
    }

    extractionInProgress = true;
    if (button) { button.disabled = true; button.textContent = 'جارٍ استخراج الصوت…'; }
    status('جارٍ استخراج المسار الصوتي الأصلي. قد تستغرق العملية بعض الوقت على الهاتف…');
    try {
      const extractedFile = await window.EgyBookStudioDemux.extract({
        ...source,
        onProgress: progress => {
          if (progress > 0) status(`جارٍ استخراج الصوت الأصلي… ${Math.round(progress * 100)}٪`);
        }
      });
      const track = {
        id: makeId('extracted'),
        name: `${sourceName} · الصوت الأصلي`,
        kind: 'extracted',
        sourceMediaType: 'audio',
        file: extractedFile,
        type: extractedFile.type,
        url: makeUrl(extractedFile),
        sourceName,
        ...sourceMeta,
        volume: 1,
        trimStart: 0,
        trimEnd: 0
      };
      addTrack(track, { select: true, message: 'تم استخراج الصوت كملف مستقل وإضافته إلى مسارات المشروع. يمكنك الآن تشغيله وقصه والتحكم في مستواه.' });
      const title = $('#studioLocalAudioName');
      if (title) title.textContent = extractedFile.name;
      return true;
    } catch (error) {
      const code = String(error?.message || error || 'EXTRACTION_FAILED');
      const messages = {
        NO_EXTRACTABLE_AUDIO: 'الفيديو أو المصدر المحدد لا يحتوي على مسار صوتي قابل للاستخراج.',
        EMPTY_AUDIO_OUTPUT: 'لم ينتج ملف صوتي من المصدر المحدد.',
        SOURCE_DOWNLOAD_FAILED: 'تعذر الوصول إلى صوت الـ Reel من مصدره. قد يمنع خادم المصدر تحميله من المتصفح.',
        SOURCE_TOO_LARGE: 'حجم الفيديو أكبر من الحد الآمن للاستخراج على هذا الجهاز. جرّب نسخة أصغر.',
        EXTRACTION_IN_PROGRESS: 'هناك عملية استخراج أخرى قيد التنفيذ.',
        INVALID_SOURCE_URL: 'رابط مصدر الصوت غير صالح.'
      };
      status(messages[code] || 'تعذر استخراج الصوت من هذا المصدر. جرّب ملف فيديو آخر أو مصدرًا متاحًا.', 'error');
      return false;
    } finally {
      extractionInProgress = false;
      if (button) { button.disabled = false; button.textContent = originalLabel; }
    }
  }

  async function prepareRecordingMix(micStream, musicVolume = 0.7) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const cleanupNodes = [];
    let micSource = null, micGain = null;
    let musicConnected = false;
    try {
      if (!AudioContextClass) throw new Error('WEB_AUDIO_UNAVAILABLE');
      if (!mixContext) {
        mixContext = new AudioContextClass();
        mixDestination = mixContext.createMediaStreamDestination();
      }
      if (mixContext.state === 'suspended') await mixContext.resume();

      const media = activeElement;
      const track = activeTrack;
      if (media && track && track.__egybookCorsRetry) {
        status('مصدر الصوت لا يسمح بالتقاطه بسبب CORS؛ سيُسجّل صوت الميكروفون فقط مع استمرار معاينة المصدر.', 'warn');
      } else if (media && track) {
        let graph = mediaGraphNodes.get(media);
        if (!graph) {
          // One MediaElementAudioSourceNode per media element for its entire life.
          const source = mixContext.createMediaElementSource(media);
          const gain = mixContext.createGain();
          source.connect(gain);
          gain.connect(mixContext.destination);
          graph = { source, gain };
          mediaGraphNodes.set(media, graph);
        }
        mixMusicGain = graph.gain;
        graph.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, Number(musicVolume) || 0)), mixContext.currentTime, 0.025);
        graph.gain.connect(mixDestination);
        musicConnected = true;
        cleanupNodes.push(() => { try { graph.gain.disconnect(mixDestination); } catch (_) {} });
        recordingMixCount++;
        try {
          const bounds = trimBounds(track, media);
          if (media.currentTime < bounds.start || (bounds.end > 0 && media.currentTime >= bounds.end)) media.currentTime = bounds.start;
        } catch (_) {}
        const playResult = media.play();
        if (playResult?.catch) await playResult.catch(() => {});
      }

      if (micStream?.getAudioTracks?.().length) {
        const micOnlyStream = new MediaStream(micStream.getAudioTracks());
        micSource = mixContext.createMediaStreamSource(micOnlyStream);
        micGain = mixContext.createGain();
        micGain.gain.value = 1;
        micSource.connect(micGain);
        micGain.connect(mixDestination);
        cleanupNodes.push(() => {
          try { micSource.disconnect(); } catch (_) {}
          try { micGain.disconnect(); } catch (_) {}
        });
      }

      const destinationTrack = mixDestination.stream.getAudioTracks()[0] || null;
      if (!destinationTrack) throw new Error('NO_MIX_TRACK');
      const audioTrack = destinationTrack.clone ? destinationTrack.clone() : destinationTrack;
      let cleaned = false;
      return {
        audioTrack,
        cleanup() {
          if (cleaned) return;
          cleaned = true;
          cleanupNodes.forEach(fn => { try { fn(); } catch (_) {} });
          if (musicConnected) recordingMixCount = Math.max(0, recordingMixCount - 1);
          if (audioTrack !== destinationTrack) { try { audioTrack.stop(); } catch (_) {} }
        }
      };
    } catch (error) {
      cleanupNodes.forEach(fn => { try { fn(); } catch (_) {} });
      if (musicConnected) recordingMixCount = Math.max(0, recordingMixCount - 1);
      status('تعذر دمج الموسيقى والميكروفون في هذا المتصفح. سيُسجّل المقطع بصوت الميكروفون فقط.', 'warn');
      return null;
    }
  }

  function playPause() {
    if (!activeElement || !activeTrack) {
      const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
      if (tracks[0]) { void selectTrack(tracks[0], { autoplay: true }); return; }
      status('أضف ملفًا صوتيًا أو استخدم صوت Reel أولًا.');
      return;
    }
    if (activeElement.paused) {
      const bounds = trimBounds(activeTrack, activeElement);
      if (activeElement.currentTime < bounds.start || (bounds.end > 0 && activeElement.currentTime >= bounds.end)) {
        try { activeElement.currentTime = bounds.start; } catch (_) {}
      }
      activeElement.play().catch(error => status(error?.name === 'NotAllowedError' ? 'اضغط تشغيل مرة أخرى للسماح بالصوت.' : 'تعذر تشغيل هذا المسار.', 'warn'));
    } else activeElement.pause();
    updatePlayerUI();
    renderTracks();
  }

  function seekFraction(value) {
    if (!activeElement || !activeTrack) return;
    const bounds = trimBounds(activeTrack, activeElement);
    if (bounds.end <= bounds.start) return;
    activeElement.currentTime = bounds.start + (Math.max(0, Math.min(1000, Number(value) || 0)) / 1000) * (bounds.end - bounds.start);
    updatePlayerUI();
  }

  function setRecordingMusicVolume(value) {
    if (!mixMusicGain || !mixContext) return;
    const normalized = Math.max(0, Math.min(1, Number(value) / 100));
    try { mixMusicGain.gain.setTargetAtTime(normalized, mixContext.currentTime, 0.025); } catch (_) {}
  }

  function setVolume(value) {
    if (!activeElement) return;
    activeElement.volume = Math.max(0, Math.min(1, Number(value) / 100));
    if (activeTrack) activeTrack.volume = activeElement.volume;
    updatePlayerUI();
    window.EgyBookStudioEditor?.markDirty?.();
  }

  function updateTrim(which, value) {
    if (!activeTrack || !activeElement) return;
    const bounds = trimBounds(activeTrack, activeElement);
    const next = Math.max(0, Math.min(bounds.duration || 9999, Number(value) || 0));
    if (which === 'start') activeTrack.trimStart = Math.min(next, Math.max(0, bounds.end - .1));
    else activeTrack.trimEnd = Math.max(next, Number(activeTrack.trimStart || activeTrack.sourceStart || 0) + .1);
    const currentBounds = trimBounds(activeTrack, activeElement);
    if (activeElement.currentTime < currentBounds.start || activeElement.currentTime > currentBounds.end) {
      try { activeElement.currentTime = currentBounds.start; } catch (_) {}
    }
    updatePlayerUI();
    window.dispatchEvent(new Event('egybook:studio-dirty'));
  }

  async function startVoice() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status('تسجيل التعليق الصوتي غير مدعوم في هذا المتصفح.');
      return;
    }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
      voiceRecorder = mime ? new MediaRecorder(voiceStream, { mimeType: mime }) : new MediaRecorder(voiceStream);
      voiceRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
      voiceRecorder.onstop = () => {
        const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || 'audio/webm' });
        if (blob.size) trackFile(new File([blob], `EgyBook-Voice-${Date.now()}.webm`, { type: blob.type }), 'voice');
        voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null; voiceRecorder = null;
        const button = $('#studioVoiceButton'); if (button) button.textContent = 'تسجيل Voice Over';
      };
      voiceRecorder.start();
      const button = $('#studioVoiceButton'); if (button) button.textContent = 'إيقاف التسجيل';
      status('جارٍ تسجيل التعليق الصوتي…');
    } catch (_) { status('لم يتم منح إذن الميكروفون.'); }
  }

  document.addEventListener('change', event => {
    if (event.target.id === 'studioAudioInput') {
      const file = event.target.files?.[0];
      if (file) trackFile(file, 'music');
      event.target.value = '';
    }
    if (event.target.id === 'studioAudioVolume') setVolume(event.target.value);
    if (event.target.id === 'studioAudioTrim') updateTrim('start', event.target.value);
    if (event.target.id === 'studioAudioTrimEnd') updateTrim('end', event.target.value);
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'studioAudioVolume') setVolume(event.target.value);
    if (event.target.id === 'studioAudioTrim') updateTrim('start', event.target.value);
    if (event.target.id === 'studioAudioTrimEnd') updateTrim('end', event.target.value);
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-studio-audio-action="import"]')) $('#studioAudioInput')?.click();
    if (event.target.closest('[data-studio-audio-action="voice"]')) {
      if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
      else void startVoice();
    }
    if (event.target.closest('[data-studio-audio-action="extract"]')) void addExtractedVideoAudio('clip');
    if (event.target.closest('[data-studio-audio-action="extract-reel"]')) void addExtractedVideoAudio('reel');
    const play = event.target.closest('[data-audio-track-play]');
    if (play) {
      const id = play.dataset.audioTrackPlay;
      if (id === activeTrackId && activeElement && !activeElement.paused) activeElement.pause();
      else {
        const track = (window.EgyBookStudioEditor?.getAudioTracks?.() || []).find(item => item.id === id);
        if (track) void selectTrack(track, { autoplay: true });
      }
      updatePlayerUI(); renderTracks();
    }
    const remove = event.target.closest('[data-audio-track-remove]');
    if (remove) {
      const id = remove.dataset.audioTrackRemove;
      if (id === activeTrackId) stopCurrent({ clearSource: true });
      const track = (window.EgyBookStudioEditor?.getAudioTracks?.() || []).find(item => item.id === id);
      if (track?.url && audioUrls.has(track.url)) { URL.revokeObjectURL(track.url); audioUrls.delete(track.url); }
      window.EgyBookStudioEditor?.removeAudioTrack?.(id);
      renderTracks();
      window.dispatchEvent(new Event('egybook:studio-dirty'));
    }
  });

  window.EgyBookStudioAudio = {
    addSource,
    addExtractedVideoAudio,
    syncTracks() {
      const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
      tracks.forEach(track => { if (track.file && !track.url) track.url = makeUrl(track.file); });
      renderTracks();
    },
    restore() {
      const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
      tracks.forEach(track => { if (track.file && !track.url) track.url = makeUrl(track.file); });
      renderTracks();
      if (tracks.length) void selectTrack(tracks[0]);
    },
    getCurrentElement: () => activeElement,
    getCurrentTrack: () => activeTrack,
    prepareRecordingMix,
    togglePlayback: playPause,
    seekFraction,
    setVolume,
    setRecordingMusicVolume,
    cleanup() {
      if (voiceRecorder && voiceRecorder.state !== 'inactive') { try { voiceRecorder.stop(); } catch (_) {} }
      voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null;
      stopCurrent({ clearSource: true });
      const source = $('#studioSourceAudioVideo'), audio = $('#studioAudioPreview');
      [source, audio].forEach(media => { if (media) { try { media.pause(); media.removeAttribute('src'); media.load(); } catch (_) {} } });
      audioUrls.forEach(url => URL.revokeObjectURL(url)); audioUrls.clear();
    }
  };

  // Media elements are intentionally controlled by EgyBook's own controls only.
  const sourceVideo = $('#studioSourceAudioVideo'), localAudio = $('#studioAudioPreview');
  [sourceVideo, localAudio].filter(Boolean).forEach(attachPlaybackEvents);
})();
