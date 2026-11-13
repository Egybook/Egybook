/* EgyBook Studio — opt-in camera capture. Camera permissions are requested only after a tap. */
(() => {
  'use strict';
  if (window.EgyBookStudioCamera) return;
  let stream = null, recorder = null, chunks = [], timer = 0, countdownTimer = 0, startedAt = 0, elapsedBeforePause = 0, facing = 'user';
  const $ = selector => document.querySelector(selector);
  const preview = () => $('#studioCameraPreview');
  const status = (message, kind) => window.EgyBookStudio?.status(message, kind);
  function stopStream() { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; const video = preview(); if (video) video.srcObject = null; }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { status('الكاميرا غير مدعومة في هذا المتصفح أو تحتاج اتصال HTTPS.', 'warn'); return false; }
    stopStream();
    const quality = $('#studioCameraQuality')?.value || '1080';
    const height = Number(quality) || 1080;
    const constraints = { audio: true, video: { facingMode: facing, width: { ideal: height === 2160 ? 3840 : height === 720 ? 1280 : 1920 }, height: { ideal: height }, frameRate: { ideal: 30, max: 60 } } };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = preview(); if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
      status('الكاميرا جاهزة. الجودة الفعلية تعتمد على إمكانيات الجهاز والمتصفح.');
      return true;
    } catch (error) {
      status(error?.name === 'NotAllowedError' ? 'اسمح باستخدام الكاميرا والميكروفون من إعدادات المتصفح.' : 'تعذر تشغيل الكاميرا بهذه الجودة. جرّب 720p أو تحقق من صلاحيات الجهاز.', 'error');
      return false;
    }
  }
  async function toggleFlash(button) {
    const track = stream?.getVideoTracks?.()[0]; if (!track) { status('شغّل الكاميرا أولًا.'); return; }
    try {
      const capabilities = track.getCapabilities?.();
      if (!capabilities?.torch) { status('الفلاش غير مدعوم في هذه الكاميرا.'); return; }
      const enabled = button.dataset.enabled !== 'true';
      await track.applyConstraints({ advanced: [{ torch: enabled }] });
      button.dataset.enabled = String(enabled); button.classList.toggle('is-active', enabled); status(enabled ? 'تم تشغيل الفلاش.' : 'تم إيقاف الفلاش.');
    } catch (_) { status('لم تسمح الكاميرا بتغيير الفلاش أثناء التصوير.'); }
  }
  async function startRecording() {
    if (!stream && !(await startCamera())) return;
    if (!window.MediaRecorder) { status('تسجيل الفيديو غير مدعوم في هذا المتصفح.', 'warn'); return; }
    chunks = []; elapsedBeforePause = 0; startedAt = Date.now();
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
    try { recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
    catch (_) { status('تعذر بدء التسجيل بهذا الجهاز.'); return; }
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
      if (blob.size) { const file = new File([blob], `EgyBook-Studio-${Date.now()}.webm`, { type: blob.type }); window.EgyBookStudioEditor?.addFiles([file], 'camera'); status('تم حفظ المقطع في خط الزمن.'); }
      chunks = []; recorder = null; clearInterval(timer); updateTimer(0);
    };
    recorder.start(500); timer = setInterval(() => updateTimer(elapsedBeforePause + (recorder?.state === 'recording' ? (Date.now() - startedAt) / 1000 : 0)), 250);
    setCameraButtons(); status('بدأ التسجيل.');
  }
  function updateTimer(seconds) { const node = $('#studioCameraTimer'); if (node) { const n = Math.max(0, Math.floor(seconds)); node.textContent = `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; } }
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
    if (record) record.disabled = active;
    if (pause) { pause.disabled = !active; pause.textContent = recorder?.state === 'paused' ? 'استكمال' : 'إيقاف مؤقت'; }
    if (stop) stop.disabled = !active;
  }
  document.addEventListener('click', async event => {
    const cameraFilter = event.target.closest('[data-studio-camera-filter]');
    if (cameraFilter) {
      const presets = { none: 'none', cinematic: 'contrast(1.12) saturate(1.15)', warm: 'sepia(.18) saturate(1.18)', cool: 'hue-rotate(9deg) saturate(.92)', mono: 'grayscale(1)', vintage: 'sepia(.35) contrast(1.08)', vivid: 'saturate(1.5) contrast(1.08)' };
      const video = preview(); if (video) video.style.filter = presets[cameraFilter.dataset.studioCameraFilter] || 'none';
      document.querySelectorAll('[data-studio-camera-filter]').forEach(item => item.classList.toggle('is-active', item === cameraFilter));
      return;
    }
    const button = event.target.closest('[data-studio-camera-action]'); if (!button) return;
    const action = button.dataset.studioCameraAction;
    if (action === 'start') await startCamera();
    if (action === 'switch') { if (recorder && recorder.state !== 'inactive') { status('أوقف التسجيل قبل تبديل الكاميرا.'); return; } facing = facing === 'user' ? 'environment' : 'user'; await startCamera(); }
    if (action === 'flash') await toggleFlash(button);
    if (action === 'record') await startRecording();
    if (action === 'pause') pauseResume();
    if (action === 'stop') stopRecording();
    if (action === 'timer') {
      const seconds = Number($('#studioCountdown')?.value || 0);
      if (seconds > 0) { clearTimeout(countdownTimer); status(`سيبدأ التسجيل بعد ${seconds} ثوانٍ.`); countdownTimer = window.setTimeout(() => { countdownTimer = 0; startRecording(); }, seconds * 1000); }
      else startRecording();
    }
  });
  window.EgyBookStudioCamera = { startCamera, stop: () => { clearTimeout(countdownTimer); countdownTimer = 0; if (recorder && recorder.state !== 'inactive') recorder.stop(); stopStream(); clearInterval(timer); } };
})();
