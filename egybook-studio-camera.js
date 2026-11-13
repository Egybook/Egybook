/* EgyBook Studio V27.4 — responsive camera capture, photo mode and optional audio mix. */
(() => {
  'use strict';
  if (window.EgyBookStudioCamera) return;
  let stream = null, recorder = null, chunks = [], timer = 0, countdownTimer = 0;
  let startedAt = 0, elapsedBeforePause = 0, facing = 'user', drawFrame = 0;
  let canvasStream = null, recordingStream = null, mixHandle = null;
  let selectedFilter = 'none', beauty = 0, photoMode = false, currentMode = 'video', recordLimit = 15, pendingClipSpeed = 1, limitStopQueued = false, micEnabled = true, starting = false, cameraRequestId = 0;
  const $ = selector => document.querySelector(selector);
  const preview = () => $('#studioCameraPreview');
  const stage = () => $('#studioCameraStage');
  const status = (message, kind) => window.EgyBookStudio?.status(message, kind);
  const FILTERS = {
    none: 'none', cinematic: 'contrast(1.12) saturate(1.15)', warm: 'sepia(.18) saturate(1.18)',
    cool: 'hue-rotate(9deg) saturate(.92)', mono: 'grayscale(1)', vintage: 'sepia(.35) contrast(1.08)',
    vivid: 'saturate(1.5) contrast(1.08)'
  };
  function updateFilter() {
    const video = preview();
    const soft = Math.max(0, beauty) / 100;
    if (video) video.style.filter = `${FILTERS[selectedFilter] || 'none'} brightness(${100 + soft * 7}%) saturate(${100 + soft * 12}%)`;
  }
  function syncMicButton() {
    const button = $('[data-studio-camera-action="mic"]');
    if (!button) return;
    button.classList.toggle('is-active', micEnabled);
    button.setAttribute('aria-pressed', String(micEnabled));
    button.setAttribute('aria-label', micEnabled ? 'كتم الميكروفون' : 'تشغيل الميكروفون');
  }
  function updateSoundChip() {
    const track = window.EgyBookStudioAudio?.getCurrentTrack?.();
    const chip = $('#studioCameraSoundChip');
    const name = $('#studioCameraSoundName');
    if (chip) chip.hidden = !track;
    if (name) name.textContent = track?.name || 'الصوت المختار';
  }
  function stopStream() {
    if (stream) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    stream = null;
    const video = preview(); if (video) video.srcObject = null;
  }
  function isActive() { return !!stream?.getVideoTracks?.().some(track => track.readyState === 'live'); }
  function isRecording() { return !!recorder && recorder.state !== 'inactive'; }
  async function startCamera() {
    if (isActive()) { const video = preview(); if (video && video.paused) await video.play().catch(() => {}); return true; }
    if (starting) return false;
    if (!navigator.mediaDevices?.getUserMedia) { status('الكاميرا غير مدعومة في هذا المتصفح أو تحتاج اتصال HTTPS.', 'warn'); return false; }
    if (recorder && recorder.state !== 'inactive') { status('أوقف التسجيل الحالي قبل إعادة تشغيل الكاميرا.', 'warn'); return false; }
    stopStream();
    const quality = $('#studioCameraQuality')?.value || '1080';
    const height = Number(quality) || 1080;
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { facingMode: { ideal: facing }, width: { ideal: height === 2160 ? 3840 : height === 720 ? 1280 : 1920 }, height: { ideal: height }, frameRate: { ideal: 30, max: 60 } }
    };
    try {
      starting = true;
      const requestId = ++cameraRequestId;
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== cameraRequestId) { nextStream.getTracks().forEach(track => track.stop()); starting = false; return false; }
      stream = nextStream;
      starting = false;
      stream.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
      syncMicButton();
      const video = preview();
      if (video) { video.srcObject = stream; video.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none'; await video.play().catch(() => {}); }
      const empty = $('#studioCameraEmpty'); if (empty) empty.hidden = true;
      updateFilter(); updateSoundChip();
      status('الكاميرا جاهزة. الجودة والفلاش يعتمدان على إمكانيات جهازك والمتصفح.');
      return true;
    } catch (error) {
      starting = false;
      status(error?.name === 'NotAllowedError' ? 'اسمح باستخدام الكاميرا والميكروفون من إعدادات المتصفح.' : 'تعذر تشغيل الكاميرا بهذه الجودة. جرّب 720p أو تحقق من صلاحيات الجهاز.', 'error');
      return false;
    }
  }
  function toggleMic(button) {
    micEnabled = !micEnabled;
    stream?.getAudioTracks?.().forEach(track => { track.enabled = micEnabled; });
    syncMicButton();
    status(micEnabled ? 'تم تشغيل الميكروفون.' : 'تم كتم الميكروفون.');
  }
  async function toggleFlash(button) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) { status('شغّل الكاميرا أولًا.'); return; }
    try {
      const capabilities = track.getCapabilities?.();
      if (!capabilities?.torch) { status('الفلاش غير مدعوم في هذه الكاميرا.'); return; }
      const enabled = button.dataset.enabled !== 'true';
      await track.applyConstraints({ advanced: [{ torch: enabled }] });
      button.dataset.enabled = String(enabled); button.classList.toggle('is-active', enabled);
      status(enabled ? 'تم تشغيل الفلاش.' : 'تم إيقاف الفلاش.');
    } catch (_) { status('لم تسمح الكاميرا بتغيير الفلاش أثناء التصوير.'); }
  }
  function drawFilteredCanvas() {
    const video = preview(), canvas = $('#studioCameraCanvas');
    const context = canvas?.getContext?.('2d', { alpha: false, desynchronized: true });
    if (!video || !canvas || !context || !video.videoWidth || !video.videoHeight) return false;
    const maxWidth = Number($('#studioCameraQuality')?.value) === 2160 ? 3840 : 1920;
    const width = Math.min(maxWidth, video.videoWidth), height = Math.round(width * video.videoHeight / video.videoWidth);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const soft = Math.max(0, beauty) / 100;
    context.save();
    context.filter = `${FILTERS[selectedFilter] || 'none'} brightness(${100 + soft * 7}%) saturate(${100 + soft * 12}%)`;
    if (facing === 'user') { context.translate(width, 0); context.scale(-1, 1); }
    context.drawImage(video, 0, 0, width, height);
    context.restore();
    // A very subtle smoothing pass is intentionally omitted; Canvas blur would
    // soften the entire frame and not provide face-aware beauty processing.
    return true;
  }
  function beginCanvasCapture(fps) {
    const video = preview(), canvas = $('#studioCameraCanvas');
    if (!video || !canvas || typeof canvas.captureStream !== 'function') return null;
    const draw = () => { drawFilteredCanvas(); drawFrame = requestAnimationFrame(draw); };
    cancelAnimationFrame(drawFrame); drawFrame = requestAnimationFrame(draw);
    try { canvasStream = canvas.captureStream(fps); return canvasStream; }
    catch (_) { cancelAnimationFrame(drawFrame); drawFrame = 0; return null; }
  }
  async function capturePhoto() {
    if (!isActive() && !(await startCamera())) return;
    const video = preview();
    if (!video?.videoWidth || !video?.videoHeight) { status('الكاميرا لم تجهز لالتقاط الصورة بعد.', 'warn'); return; }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2560 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { status('تعذر تجهيز الصورة على هذا الجهاز.', 'error'); return; }
    const soft = Math.max(0, beauty) / 100;
    context.filter = `${FILTERS[selectedFilter] || 'none'} brightness(${100 + soft * 7}%) saturate(${100 + soft * 12}%)`;
    if (facing === 'user') { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { status('تعذر حفظ الصورة الملتقطة.', 'error'); return; }
      const file = new File([blob], `EgyBook-Studio-${Date.now()}.jpg`, { type: 'image/jpeg' });
      window.EgyBookStudioEditor?.addFiles([file], 'camera');
      status('تم التقاط الصورة وإضافتها إلى المحرر.');
    }, 'image/jpeg', .92);
  }
  async function startRecording() {
    if (photoMode) { await capturePhoto(); return; }
    if (!stream && !(await startCamera())) return;
    limitStopQueued = false;
    if (!window.MediaRecorder) { status('تسجيل الفيديو غير مدعوم في هذا المتصفح.', 'warn'); return; }
    const fps = Number($('#studioExportFps')?.value || 30);
    chunks = []; elapsedBeforePause = 0; startedAt = Date.now();
    let videoStream = beginCanvasCapture(fps);
    if (!videoStream) { videoStream = new MediaStream(stream.getVideoTracks()); status('تسجيل الفلاتر داخل الفيديو غير مدعوم هنا؛ سيتم استخدام مسار الكاميرا الأصلي.', 'warn'); }
    recordingStream = new MediaStream(videoStream.getVideoTracks());
    mixHandle = await window.EgyBookStudioAudio?.prepareRecordingMix?.(stream, Number($('#studioCameraMusicVolume')?.value ?? 70) / 100) || null;
    const audioTrack = mixHandle?.audioTrack || stream.getAudioTracks()[0];
    if (audioTrack) recordingStream.addTrack(audioTrack);
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
    try { recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 160_000 }) : new MediaRecorder(recordingStream); }
    catch (error) { teardownCapture(); status('تعذر بدء التسجيل بهذا الجهاز. جرّب جودة أقل أو متصفحًا آخر.', 'error'); return; }
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => { status('حدث خطأ أثناء التسجيل. أوقف المقطع وحاول مجددًا.', 'error'); };
    recorder.onstop = () => {
      const type = recorder?.mimeType || chunks[0]?.type || 'video/webm';
      const extension = type.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type });
      if (blob.size) {
        const file = new File([blob], `EgyBook-Studio-${Date.now()}.${extension}`, { type: blob.type });
        window.EgyBookStudioEditor?.addFiles([file], 'camera').then(() => {
          if (pendingClipSpeed !== 1) window.EgyBookStudioEditor?.setSelectedSpeed?.(pendingClipSpeed);
        });
        status('تم حفظ المقطع داخل خط الزمن.');
      } else status('لم ينتج ملف فيديو. حاول التسجيل مرة أخرى.', 'error');
      chunks = []; recorder = null; clearInterval(timer); updateTimer(0); teardownCapture(); setCameraButtons();
    };
    try { recorder.start(500); }
    catch (_) { recorder = null; teardownCapture(); status('تعذر بدء التسجيل.'); return; }
    timer = setInterval(() => updateTimer(elapsedBeforePause + (recorder?.state === 'recording' ? (Date.now() - startedAt) / 1000 : 0)), 250);
    stage()?.classList.add('is-recording'); setCameraButtons(); status('بدأ التسجيل. الصوت المختار سيُدمج مع الميكروفون عند دعم المتصفح والمصدر لذلك.');
  }
  function teardownCapture() {
    cancelAnimationFrame(drawFrame); drawFrame = 0;
    mixHandle?.cleanup?.(); mixHandle = null;
    canvasStream?.getTracks?.().forEach(track => { try { track.stop(); } catch (_) {} }); canvasStream = null;
    recordingStream?.getTracks?.().forEach(track => { try { track.stop(); } catch (_) {} }); recordingStream = null;
    stage()?.classList.remove('is-recording');
  }
  function updateTimer(seconds) {
    const node = $('#studioCameraTimer');
    const n = Math.max(0, Number(seconds) || 0);
    if (node) { const whole = Math.floor(n); node.textContent = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`; }
    if (recordLimit > 0 && recorder?.state === 'recording' && n >= recordLimit && !limitStopQueued) {
      limitStopQueued = true;
      status(`اكتملت مدة التصوير المحددة (${recordLimit} ثانية).`);
      stopRecording();
    }
  }
  function pauseResume() {
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); elapsedBeforePause += (Date.now() - startedAt) / 1000; status('تم إيقاف التسجيل مؤقتًا.'); }
    else if (recorder.state === 'paused') { startedAt = Date.now(); recorder.resume(); status('استكمل التسجيل.'); }
    setCameraButtons();
  }
  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); setCameraButtons(); }
  function setCameraButtons() {
    const record = $('#studioRecordButton'), pause = $('#studioPauseButton'), stop = $('#studioStopButton');
    const active = !!recorder && recorder.state !== 'inactive';
    if (record) { record.disabled = active; record.setAttribute('aria-label', photoMode ? 'التقاط صورة' : 'بدء التسجيل'); }
    if (pause) { pause.disabled = !active || photoMode; const label = pause.querySelector('span'); if (label) label.textContent = recorder?.state === 'paused' ? 'استكمال' : 'إيقاف مؤقت'; }
    if (stop) stop.disabled = !active;
  }
  function setMode(mode) {
    if (!['photo', 'video', 'reel', 'story'].includes(mode)) return false;
    if (isRecording()) { status('أوقف التسجيل الحالي قبل تغيير وضع التصوير.', 'warn'); return false; }
    currentMode = mode;
    photoMode = mode === 'photo';
    const cameraPanel = document.querySelector('[data-studio-panel="camera"]');
    cameraPanel?.classList.toggle('is-photo-mode', photoMode);
    if (cameraPanel) cameraPanel.dataset.cameraMode = mode;
    document.querySelectorAll('[data-studio-camera-mode]').forEach(button => {
      const active = button.dataset.studioCameraMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const duration = $('.studio-camera-duration');
    if (duration) duration.hidden = photoMode;
    const record = $('#studioRecordButton');
    if (record) {
      record.classList.toggle('is-photo-capture', photoMode);
      record.setAttribute('aria-label', photoMode ? 'التقاط صورة' : 'بدء التسجيل');
      record.dataset.captureMode = photoMode ? 'photo' : 'video';
    }
    setCameraButtons();
    return true;
  }
  function setDuration(seconds) { recordLimit = Math.max(0, Math.min(60, Number(seconds) || 15)); }
  async function switchCamera() {
    if (recorder && recorder.state !== 'inactive') { status('أوقف التسجيل قبل تبديل الكاميرا.'); return; }
    // Invalidate any pending getUserMedia request and release the current lens first.
    cameraRequestId++; starting = false;
    stopStream();
    const flashButton = $('[data-studio-camera-action="flash"]');
    if (flashButton) { flashButton.dataset.enabled = 'false'; flashButton.classList.remove('is-active'); }
    facing = facing === 'user' ? 'environment' : 'user';
    await startCamera();
  }
  async function runCountdown() {
    const seconds = Number($('#studioCountdown')?.value || 0);
    const overlay = $('#studioCameraCountdownOverlay');
    clearTimeout(countdownTimer);
    if (!seconds) { await startRecording(); return; }
    let remaining = seconds;
    if (overlay) { overlay.hidden = false; overlay.textContent = String(remaining); }
    const tick = async () => {
      remaining--;
      if (remaining <= 0) { if (overlay) overlay.hidden = true; countdownTimer = 0; await startRecording(); return; }
      if (overlay) overlay.textContent = String(remaining);
      countdownTimer = window.setTimeout(tick, 1000);
    };
    countdownTimer = window.setTimeout(tick, 1000);
  }
  document.addEventListener('input', event => {
    if (event.target.id === 'studioCameraBeauty') { beauty = Number(event.target.value) || 0; updateFilter(); }
    if (event.target.id === 'studioCameraMusicVolume') window.EgyBookStudioAudio?.setRecordingMusicVolume?.(event.target.value);
    if (event.target.id === 'studioCameraSpeed') pendingClipSpeed = Math.max(0.5, Math.min(2, Number(event.target.value) || 1));
  });
  document.addEventListener('egybook:studio-panel-changed', () => { updateSoundChip(); syncMicButton(); });
  document.addEventListener('click', async event => {
    const filter = event.target.closest('[data-studio-camera-filter]');
    if (filter) {
      selectedFilter = filter.dataset.studioCameraFilter || 'none';
      document.querySelectorAll('[data-studio-camera-filter]').forEach(item => item.classList.toggle('is-active', item === filter));
      updateFilter(); return;
    }
    const button = event.target.closest('[data-studio-camera-action]'); if (!button) return;
    const action = button.dataset.studioCameraAction;
    if (action === 'filter-toggle') {
      const rail = $('#studioCameraFilterRail');
      const expanded = rail ? rail.hidden : true;
      if (rail) rail.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      button.classList.toggle('is-active', expanded);
      return;
    }
    if (action === 'speed') { window.EgyBookStudioUI?.openTool?.('camera-settings'); return; }
    if (action === 'start') await startCamera();
    if (action === 'switch') await switchCamera();
    if (action === 'flash') await toggleFlash(button);
    if (action === 'mic') toggleMic(button);
    if (action === 'record') await runCountdown();
    if (action === 'pause') pauseResume();
    if (action === 'stop') stopRecording();
    if (action === 'timer') await runCountdown();
    if (action === 'timer-cancel') { clearTimeout(countdownTimer); countdownTimer = 0; const overlay = $('#studioCameraCountdownOverlay'); if (overlay) overlay.hidden = true; status('تم إلغاء مؤقت التصوير.'); }
  });
  window.EgyBookStudioCamera = {
    startCamera, isActive, isRecording, setMode, setDuration, getMode: () => currentMode,
    stop() {
      cameraRequestId++; starting = false;
      clearTimeout(countdownTimer); countdownTimer = 0;
      const countdown = $('#studioCameraCountdownOverlay'); if (countdown) countdown.hidden = true;
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      else teardownCapture();
      stopStream(); clearInterval(timer); setCameraButtons();
    }
  };
})();
