/* EgyBook Studio — local audio, voice-over and real-time audio extraction. */
(() => {
  'use strict';
  if (window.EgyBookStudioAudio) return;
  let voiceStream = null, voiceRecorder = null, voiceChunks = [], extractingRecorder = null, extractingStream = null, extractingVideo = null;
  const audioUrls = new Set();
  const $ = selector => document.querySelector(selector);
  const status = (message, kind = 'info') => window.EgyBookStudio?.status(message, kind);

  function trackFile(file, kind = 'music') {
    const url = URL.createObjectURL(file); audioUrls.add(url);
    const audio = $('#studioAudioPreview');
    if (audio) { audio.src = url; audio.hidden = false; }
    const title = $('#studioLocalAudioName');
    if (title) title.textContent = file.name || (kind === 'voice' ? 'تعليق صوتي' : 'مسار صوتي');
    const track = { id: `audio-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: file.name || (kind === 'voice' ? 'تعليق صوتي' : 'مسار صوتي'), file, type: file.type, kind, url };
    window.EgyBookStudioEditor?.addAudioTrack(track);
    renderTracks();
    renderWave(file).catch(() => {});
    status(kind === 'voice' ? 'تمت إضافة التعليق الصوتي إلى المشروع.' : kind === 'extracted' ? 'تم استخراج الصوت وإضافته إلى مسارات المشروع.' : 'تمت إضافة المسار الصوتي إلى المشروع.');
    return track;
  }

  async function renderWave(file) {
    const canvas = $('#studioAudioWaveform'); if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const audioContext = new AC();
    try {
      const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / canvas.width));
      context.fillStyle = '#21d7ff';
      for (let x = 0; x < canvas.width; x++) { let peak = 0; for (let i = 0; i < step; i++) peak = Math.max(peak, Math.abs(data[x * step + i] || 0)); const h = Math.max(2, peak * canvas.height * .9); context.fillRect(x, (canvas.height - h) / 2, 2, h); }
    } finally { await audioContext.close().catch(() => {}); }
  }

  function renderTracks() {
    const list = $('#studioAudioTracksList'); if (!list) return;
    const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
    list.replaceChildren();
    if (!tracks.length) { const empty = document.createElement('p'); empty.className = 'studio-empty'; empty.textContent = 'لا توجد مسارات صوتية.'; list.append(empty); return; }
    tracks.forEach(track => {
      const row = document.createElement('div'); row.className = 'studio-audio-track';
      const icon = document.createElement('span'); icon.className = 'studio-audio-track-icon'; icon.textContent = track.kind === 'voice' ? '🎙' : track.kind === 'egybook-source' ? '♫' : '♪';
      const copy = document.createElement('span'); copy.className = 'studio-audio-track-copy';
      const title = document.createElement('strong'); title.textContent = track.name || 'مسار صوتي';
      const detail = document.createElement('small'); detail.textContent = track.kind === 'egybook-source' ? 'صوت مرتبط من EgyBook' : track.kind === 'voice' ? 'تعليق صوتي' : track.kind === 'extracted' ? 'صوت مستخرج من فيديو' : 'ملف صوتي محلي';
      copy.append(title, detail); row.append(icon, copy); list.append(row);
    });
  }

  function addSource(sound) {
    const title = $('#studioSoundSourceTitle'), artist = $('#studioSoundSourceArtist'), card = $('#studioSoundSourceCard');
    if (title && sound?.title) title.textContent = sound.title;
    if (artist) artist.textContent = sound?.artist || 'صوت أصلي من EgyBook';
    if (card) card.hidden = !sound;
    const video = $('#studioSourceAudioVideo');
    if (video && sound?.mediaUrl && video.src !== sound.mediaUrl) { video.src = sound.mediaUrl; video.hidden = false; video.load(); }
    if (sound) {
      const id = `source-${sound.sourcePostId || sound.trackId || 'sound'}`;
      const tracks = window.EgyBookStudioEditor?.getAudioTracks?.() || [];
      if (!tracks.some(track => track.id === id)) window.EgyBookStudioEditor?.addAudioTrack({ id, name: sound.title || 'صوت من ريلز EgyBook', kind: 'egybook-source', sourcePostId: sound.sourcePostId || '', trackId: sound.trackId || '', mediaUrl: sound.mediaUrl || '', artist: sound.artist || '', artwork: sound.artwork || '' });
    }
    renderTracks();
  }

  function stopVoice() { if (voiceRecorder && voiceRecorder.state !== 'inactive') voiceRecorder.stop(); }
  async function startVoice() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status('تسجيل التعليق الصوتي غير مدعوم في هذا المتصفح.'); return; }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true }); voiceChunks = [];
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
      voiceRecorder = mime ? new MediaRecorder(voiceStream, { mimeType: mime }) : new MediaRecorder(voiceStream);
      voiceRecorder.ondataavailable = event => { if (event.data?.size) voiceChunks.push(event.data); };
      voiceRecorder.onstop = () => {
        const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || 'audio/webm' });
        if (blob.size) trackFile(new File([blob], `EgyBook-Voice-${Date.now()}.webm`, { type: blob.type }), 'voice');
        voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null; voiceRecorder = null;
        const button = $('#studioVoiceButton'); if (button) button.textContent = 'تسجيل Voice Over';
      };
      voiceRecorder.start(); const button = $('#studioVoiceButton'); if (button) button.textContent = 'إيقاف التسجيل'; status('جارٍ تسجيل التعليق الصوتي…');
    } catch (_) { status('لم يتم منح إذن الميكروفون.'); }
  }

  function stopExtraction(message = '') {
    if (extractingRecorder && extractingRecorder.state !== 'inactive') { try { extractingRecorder.stop(); } catch (_) {} }
    if (extractingVideo) { try { extractingVideo.pause(); } catch (_) {} }
    if (extractingStream) extractingStream.getTracks().forEach(track => track.stop());
    extractingStream = null;
    if (extractingVideo?.dataset.egybookTemporary === 'true') { const url = extractingVideo.src; extractingVideo.removeAttribute('src'); extractingVideo.load(); if (url) URL.revokeObjectURL(url); extractingVideo.remove(); }
    extractingVideo = null;
    if (message) status(message);
  }

  async function extractSelectedVideoAudio() {
    if (!window.MediaRecorder) { status('استخراج الصوت غير مدعوم في هذا المتصفح.'); return; }
    if (extractingRecorder && extractingRecorder.state !== 'inactive') { stopExtraction('تم إيقاف استخراج الصوت.'); return; }
    const clip = window.EgyBookStudioEditor?.getSelected?.();
    let video = null, temporary = false, startAt = 0, endAt = Infinity;
    if (clip?.kind === 'video' && clip.file) {
      video = document.createElement('video'); video.playsInline = true; video.preload = 'auto'; video.src = URL.createObjectURL(clip.file); video.dataset.egybookTemporary = 'true'; temporary = true;
      startAt = Math.max(0, Number(clip.in) || 0); endAt = Math.max(startAt, Number(clip.out) || clip.duration || Infinity);
    } else {
      const sourceSound = window.EgyBookStudioEditor?.getSourceSound?.();
      video = $('#studioSourceAudioVideo');
      if (!sourceSound?.mediaUrl || !video) { status('اختار فيديو من خط الزمن أو افتح الاستوديو من «استخدم هذا الصوت».'); return; }
      video.muted = false; video.volume = 1;
    }
    if (temporary) document.body.append(video);
    extractingVideo = video;
    try {
      if (video.readyState < 1) await new Promise((resolve, reject) => { video.addEventListener('loadedmetadata', resolve, { once: true }); video.addEventListener('error', () => reject(new Error('VIDEO_LOAD_FAILED')), { once: true }); video.load(); });
      const capture = video.captureStream || video.mozCaptureStream;
      if (typeof capture !== 'function') throw new Error('CAPTURE_STREAM_UNAVAILABLE');
      if (startAt && Number.isFinite(startAt)) video.currentTime = startAt;
      const captured = capture.call(video), audioTracks = captured.getAudioTracks();
      if (!audioTracks.length) { captured.getTracks().forEach(track => track.stop()); throw new Error('NO_AUDIO_TRACK'); }
      extractingStream = new MediaStream(audioTracks);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
      extractingRecorder = mime ? new MediaRecorder(extractingStream, { mimeType: mime }) : new MediaRecorder(extractingStream);
      const chunks = [], recorderRef = extractingRecorder;
      recorderRef.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorderRef.onstop = () => {
        const blob = new Blob(chunks, { type: recorderRef.mimeType || 'audio/webm' });
        if (blob.size) trackFile(new File([blob], `EgyBook-Extracted-Audio-${Date.now()}.webm`, { type: blob.type }), 'extracted');
        stopExtraction(); extractingRecorder = null;
        const extractButton = $('#studioExtractSoundButton'); if (extractButton) { extractButton.textContent = 'استخراج صوت الفيديو المحدد'; extractButton.removeAttribute('aria-busy'); }
      };
      video.muted = false; video.volume = 1;
      if (Number.isFinite(startAt) && startAt > 0 && video.currentTime !== startAt) video.currentTime = startAt;
      const onTime = () => { if (Number.isFinite(endAt) && video.currentTime >= endAt - .04 && extractingRecorder?.state === 'recording') extractingRecorder.stop(); };
      video.addEventListener('timeupdate', onTime);
      recorderRef.addEventListener?.('stop', () => video.removeEventListener('timeupdate', onTime), { once: true });
      recorderRef.start(250);
      await video.play();
      const button = $('#studioExtractSoundButton'); if (button) { button.textContent = 'إيقاف استخراج الصوت'; button.setAttribute('aria-busy', 'true'); }
      status('يتم تسجيل الصوت من المقطع المحدد لحظيًا. اترك الفيديو حتى نهاية الجزء المطلوب.');
      video.addEventListener('ended', () => { if (extractingRecorder?.state === 'recording') extractingRecorder.stop(); }, { once: true });
    } catch (error) {
      console.warn('Studio audio extraction failed:', error);
      stopExtraction(); extractingRecorder = null;
      const button = $('#studioExtractSoundButton'); if (button) { button.textContent = 'استخراج صوت الفيديو المحدد'; button.removeAttribute('aria-busy'); }
      const message = error.message === 'CAPTURE_STREAM_UNAVAILABLE' ? 'استخراج الصوت غير مدعوم في هذا المتصفح.' : error.message === 'NO_AUDIO_TRACK' ? 'الفيديو لا يحتوي على مسار صوت قابل للاستخراج.' : 'تعذر التقاط الصوت. قد يمنع المتصفح تسجيل صوت هذا المصدر أو يحتاج إذن تشغيله.';
      status(message, 'warn');
    }
  }

  document.addEventListener('change', event => {
    if (event.target.id === 'studioAudioInput') { const file = event.target.files?.[0]; if (file) trackFile(file, 'music'); event.target.value = ''; }
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-studio-audio-action="import"]')) $('#studioAudioInput')?.click();
    if (event.target.closest('[data-studio-audio-action="voice"]')) { if (voiceRecorder?.state === 'recording') stopVoice(); else startVoice(); }
    if (event.target.closest('[data-studio-audio-action="extract"]')) extractSelectedVideoAudio();
  });

  window.EgyBookStudioAudio = {
    addSource, extractSelectedVideoAudio, syncTracks: renderTracks,
    cleanup() {
      stopVoice(); voiceStream?.getTracks().forEach(track => track.stop()); voiceStream = null;
      if (extractingRecorder && extractingRecorder.state !== 'inactive') { try { extractingRecorder.stop(); } catch (_) {} }
      stopExtraction();
      audioUrls.forEach(url => URL.revokeObjectURL(url)); audioUrls.clear();
    }
  };
})();
