/* EgyBook Studio — clip bin, timeline metadata, preview and editing controls. */
(() => {
  'use strict';
  if (window.EgyBookStudioEditor) return;
  const state = { clips: [], selectedId: null, audioTracks: [], sourceSound: null, overlays: [], settings: { speed: 1, aspect: '9:16', rotation: 0, zoom: 1, filter: 'none', brightness: 100, contrast: 100, saturation: 100, transition: 'cut', exportQuality: 1080, exportFps: 30, audioVolume: 100, audioTrim: 0 }, currentProjectId: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const prettyTime = value => { const s = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function status(message, kind = 'info') { window.EgyBookStudio?.status(message, kind); }
  function markDirty() { window.dispatchEvent(new Event('egybook:studio-dirty')); }
  function selected() { return state.clips.find(item => item.id === state.selectedId) || null; }
  function revokeClipUrls() { state.clips.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); }); }
  function captureThumbnail(clip) {
    if (!clip) return;
    if (clip.kind === 'image') { clip.thumbnail = clip.url; return; }
    if (!clip.url || clip.thumbnail || typeof document === 'undefined') return;
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'metadata';
    let done = false;
    const cleanup = () => { video.removeAttribute('src'); video.load(); };
    const finish = () => { if (done) return; done = true; cleanup(); };
    video.addEventListener('loadeddata', () => {
      try { video.currentTime = Math.min(.25, Math.max(0, (Number(clip.duration) || 1) * .08)); }
      catch (_) { finish(); }
    }, { once: true });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 180 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
        canvas.width = Math.max(1, Math.round((video.videoWidth || 180) * ratio));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 100) * ratio));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        clip.thumbnail = canvas.toDataURL('image/jpeg', .58);
        renderTimeline();
      } catch (_) { /* The clip remains usable without a generated thumbnail. */ }
      finish();
    }, { once: true });
    video.addEventListener('error', finish, { once: true });
    video.src = clip.url;
  }

  async function fileInfo(file) {
    if (file.type.startsWith('image/')) return { duration: 4, width: 0, height: 0, kind: 'image' };
    if (!file.type.startsWith('video/')) return null;
    return new Promise(resolve => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      const finish = value => { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); resolve(value); };
      video.preload = 'metadata';
      video.onloadedmetadata = () => finish({ duration: Number.isFinite(video.duration) ? video.duration : 0, width: video.videoWidth || 0, height: video.videoHeight || 0, kind: 'video' });
      video.onerror = () => finish({ duration: 0, width: 0, height: 0, kind: 'video' });
      video.src = url;
    });
  }

  async function addFiles(files, source = 'device') {
    const incoming = [...(files || [])].filter(file => file && (file.type.startsWith('video/') || file.type.startsWith('image/')));
    if (!incoming.length) { status('اختار فيديو أو صورة مدعومة.'); return []; }
    const added = [];
    for (const file of incoming) {
      if (file.size > 300 * 1024 * 1024) { status(`تم تخطي ${file.name}: الحجم أكبر من 300 ميجابايت.`, 'warn'); continue; }
      const info = await fileInfo(file);
      if (!info) continue;
      const item = { id: uid(), name: file.name || (info.kind === 'image' ? 'صورة' : 'فيديو'), file, url: URL.createObjectURL(file), type: file.type, kind: info.kind, duration: info.duration, width: info.width, height: info.height, in: 0, out: info.duration, speed: 1, rotation: 0, source };
      state.clips.push(item); added.push(item); captureThumbnail(item);
    }
    if (added.length) {
      state.selectedId = added[0].id;
      render(); showPanel('editor');
      if (source === 'camera' || document.getElementById('egybookStudioModal')?.dataset.screen === 'camera') window.EgyBookStudio?.switchTab?.('editor');
      markDirty();
      status(`تمت إضافة ${added.length} من الوسائط إلى خط الزمن.`);
    }
    return added;
  }

  function showPanel(name) {
    const video = $('#studioPreviewVideo'), image = $('#studioPreviewImage');
    const active = selected();
    const empty = $('#studioPreviewEmpty'); if (empty) empty.hidden = !!active;
    if (!active) {
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true; }
      if (image) { image.removeAttribute('src'); image.hidden = true; }
      return;
    }
    if (active.kind === 'image') {
      if (video) { video.pause(); video.hidden = true; video.removeAttribute('src'); video.load(); }
      if (image) { image.src = active.url; image.hidden = false; image.style.filter = filterValue(); image.style.transform = `rotate(${active.rotation || state.settings.rotation}deg) scale(${state.settings.zoom})`; }
    } else {
      if (image) { image.hidden = true; image.removeAttribute('src'); }
      if (video) {
        if (video.dataset.clipId !== active.id) {
          video.pause(); video.src = active.url; video.dataset.clipId = active.id; video.load();
        }
        video.hidden = false; video.playbackRate = Number(active.speed || state.settings.speed || 1);
        video.style.filter = filterValue();
        video.style.transform = `rotate(${active.rotation || state.settings.rotation}deg) scale(${state.settings.zoom})`;
      }
    }
    const meta = $('#studioClipMeta');
    if (meta) meta.textContent = `${active.name} · ${active.kind === 'image' ? 'صورة' : prettyTime(active.duration)}${active.width ? ` · ${active.width}×${active.height}` : ''}`;
    syncControls();
  }

  function renderTimeline() {
    const list = $('#studioTimeline'); if (!list) return;
    list.replaceChildren();
    if (!state.clips.length) {
      const empty = document.createElement('p'); empty.className = 'studio-empty'; empty.textContent = 'أضف فيديو أو صورة لبدء المونتاج.'; list.append(empty);
      document.dispatchEvent(new CustomEvent('egybook:studio-selection-changed', { detail: { type: 'general' } }));
      document.dispatchEvent(new CustomEvent('egybook:studio-timeline-rendered'));
      return;
    }
    state.clips.forEach((clip, index) => {
      const row = document.createElement('div');
      row.className = `studio-clip${clip.id === state.selectedId ? ' is-selected' : ''}`;
      row.draggable = true; row.dataset.clipId = clip.id; row.dataset.studioSelectable = 'video';
      const thumb = document.createElement('span'); thumb.className = 'studio-clip-thumb';
      if (clip.thumbnail) {
        const image = document.createElement('img'); image.src = clip.thumbnail; image.alt = ''; image.loading = 'lazy'; thumb.append(image);
      } else {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('class', 'studio-icon'); icon.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', clip.kind === 'image' ? '#ebs-image' : '#ebs-video'); icon.append(use); thumb.append(icon);
      }
      const copy = document.createElement('span'); copy.className = 'studio-clip-copy';
      const title = document.createElement('strong'); title.textContent = clip.name;
      const detail = document.createElement('small'); detail.textContent = `${index + 1} · ${clip.kind === 'image' ? 'صورة' : prettyTime(clip.duration)}`;
      copy.append(title, detail);
      const trimStart = document.createElement('button');
      trimStart.type = 'button'; trimStart.className = 'studio-clip-trim-handle studio-clip-trim-start';
      trimStart.dataset.studioTrimEdge = 'start'; trimStart.setAttribute('aria-label', 'تقصير بداية المقطع أو تمديدها');
      trimStart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16M13 7v10M5 7h3M5 17h3"/></svg>';
      const trimEnd = document.createElement('button');
      trimEnd.type = 'button'; trimEnd.className = 'studio-clip-trim-handle studio-clip-trim-end';
      trimEnd.dataset.studioTrimEdge = 'end'; trimEnd.setAttribute('aria-label', 'تقصير نهاية المقطع أو تمديدها');
      trimEnd.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4v16M11 7v10M16 7h3M16 17h3"/></svg>';
      row.append(trimStart, thumb, copy, trimEnd);
      let suppressNextClick = false;
      row.addEventListener('click', event => {
        if (suppressNextClick) { suppressNextClick = false; event.preventDefault(); return; }
        if (event.target.closest('button')) return;
        state.selectedId = clip.id; render();
      });
      row.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', clip.id); event.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', event => { event.preventDefault(); row.classList.add('is-drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', event => { event.preventDefault(); row.classList.remove('is-drop-target'); const movingId = event.dataTransfer.getData('text/plain'); const from = state.clips.findIndex(item => item.id === movingId); const to = state.clips.findIndex(item => item.id === clip.id); if (from < 0 || to < 0 || from === to) return; const [moving] = state.clips.splice(from, 1); state.clips.splice(to, 0, moving); render(); markDirty(); });
      let touchDrag = null;
      let touchDragTimer = 0;
      const clearTouchDrag = () => { if (touchDragTimer) clearTimeout(touchDragTimer); touchDragTimer = 0; };
      row.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch' || event.target.closest('.studio-clip-trim-handle')) return;
        clearTouchDrag();
        touchDrag = { pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX, startY: event.clientY, active: false, panning: false, targetId: clip.id };
        // Let a normal horizontal swipe scroll the timeline. Reordering starts only
        // after a deliberate long-press, so the clip body does not steal touch scroll.
        touchDragTimer = setTimeout(() => {
          if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
          touchDrag.active = true;
          row.classList.add('is-touch-reordering');
          try { row.setPointerCapture(event.pointerId); } catch (_) {}
        }, 280);
      });
      row.addEventListener('pointermove', event => {
        if (!touchDrag || event.pointerId !== touchDrag.pointerId) return;
        const deltaX = event.clientX - touchDrag.startX;
        const deltaY = event.clientY - touchDrag.startY;
        const distance = Math.hypot(deltaX, deltaY);
        if (!touchDrag.active && !touchDrag.panning && distance > 10) {
          clearTouchDrag();
          if (Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
            touchDrag.panning = true;
            try { row.setPointerCapture(event.pointerId); } catch (_) {}
          } else { touchDrag = null; return; }
        }
        if (touchDrag.panning) {
          event.preventDefault();
          const timelineViewport = $('#studioTimelineStack');
          if (timelineViewport) timelineViewport.scrollLeft = Math.max(0, Math.min(timelineViewport.scrollWidth, timelineViewport.scrollLeft - (event.clientX - touchDrag.lastX)));
          touchDrag.lastX = event.clientX;
          return;
        }
        if (!touchDrag.active) return;
        event.preventDefault();
        const timelineViewport = $('#studioTimelineStack');
        if (timelineViewport) {
          const viewportRect = timelineViewport.getBoundingClientRect();
          if (event.clientX < viewportRect.left + 34) timelineViewport.scrollLeft = Math.max(0, timelineViewport.scrollLeft - 12);
          else if (event.clientX > viewportRect.right - 34) timelineViewport.scrollLeft = Math.min(timelineViewport.scrollWidth, timelineViewport.scrollLeft + 12);
        }
        const under = document.elementFromPoint(event.clientX, event.clientY)?.closest('.studio-clip');
        $$('.studio-clip').forEach(item => item.classList.remove('is-drop-target'));
        if (under && under.dataset.clipId !== clip.id) { touchDrag.targetId = under.dataset.clipId; under.classList.add('is-drop-target'); }
      });
      row.addEventListener('pointerup', event => {
        if (!touchDrag || event.pointerId !== touchDrag.pointerId) return;
        clearTouchDrag();
        const drag = touchDrag; touchDrag = null;
        row.classList.remove('is-touch-reordering');
        $$('.studio-clip').forEach(item => item.classList.remove('is-drop-target'));
        if (drag.panning) { suppressNextClick = true; return; }
        if (!drag.active || !drag.targetId || drag.targetId === clip.id) return;
        const from = state.clips.findIndex(item => item.id === clip.id), to = state.clips.findIndex(item => item.id === drag.targetId);
        if (from < 0 || to < 0 || from === to) return;
        const [moving] = state.clips.splice(from, 1); state.clips.splice(to, 0, moving);
        suppressNextClick = true; render(); markDirty();
      });
      row.addEventListener('pointercancel', () => { clearTouchDrag(); touchDrag = null; row.classList.remove('is-touch-reordering'); $$('.studio-clip').forEach(item => item.classList.remove('is-drop-target')); });
      list.append(row);
      if (index < state.clips.length - 1) {
        const transition = document.createElement('button'); transition.type = 'button'; transition.className = 'studio-transition-control';
        transition.dataset.studioTransitionBetween = clip.id; transition.setAttribute('aria-label', 'إعداد الانتقال بين المقطعين');
        transition.innerHTML = '<svg class="studio-icon" aria-hidden="true"><use href="#ebs-transition"></use></svg>';
        transition.addEventListener('click', event => { event.stopPropagation(); document.dispatchEvent(new CustomEvent('egybook:studio-transition-selected', { detail: { afterClipId: clip.id } })); });
        list.append(transition);
      }
    });
    document.dispatchEvent(new CustomEvent('egybook:studio-selection-changed', { detail: { type: state.selectedId ? 'video' : 'general', id: state.selectedId } }));
    document.dispatchEvent(new CustomEvent('egybook:studio-timeline-rendered'));
  }

  function filterValue() {
    const presets = { none: 'none', cinematic: 'contrast(1.12) saturate(1.14)', warm: 'sepia(.18) saturate(1.2)', cool: 'saturate(.9) hue-rotate(9deg)', mono: 'grayscale(1)', vintage: 'sepia(.35) contrast(1.08)', vivid: 'saturate(1.5) contrast(1.08)', soft: 'brightness(1.06) saturate(1.08)' };
    return `${presets[state.settings.filter] || 'none'} brightness(${state.settings.brightness}%) contrast(${state.settings.contrast}%) saturate(${state.settings.saturation}%)`;
  }
  function syncControls() {
    const clip = selected(); if (!clip) return;
    const speed = $('#studioSpeed'); if (speed) speed.value = String(clip.speed || state.settings.speed || 1);
    const start = $('#studioTrimStart'), end = $('#studioTrimEnd');
    if (start) { start.max = String(Math.max(0, clip.duration || 0)); start.value = String(clip.in || 0); }
    if (end) { end.max = String(Math.max(0, clip.duration || 0)); end.value = String(clip.out ?? clip.duration ?? 0); }
    $$('.studio-ratio').forEach(button => button.classList.toggle('is-active', button.dataset.ratio === state.settings.aspect));
    const stage = $('#studioPreviewStage'); if (stage) stage.dataset.aspect = state.settings.aspect;
    const set = (id, value) => { const node = $(`#${id}`); if (node && value !== undefined && value !== null) node.value = String(value); };
    set('studioBrightness', state.settings.brightness); set('studioContrast', state.settings.contrast); set('studioSaturation', state.settings.saturation);
    set('studioTransition', state.settings.transition); set('studioExportQuality', state.settings.exportQuality); set('studioExportFps', state.settings.exportFps);
    set('studioAudioVolume', state.settings.audioVolume); set('studioAudioTrim', state.settings.audioTrim);
  }
  function render() { renderTimeline(); showPanel('editor'); }

  function setSourceSound(sound) {
    if (!sound) return;
    state.sourceSound = { ...sound };
    const title = $('#studioSoundSourceTitle'), artist = $('#studioSoundSourceArtist'), card = $('#studioSoundSourceCard');
    if (title) title.textContent = sound.title || 'الصوت الأصلي من EgyBook';
    if (artist) artist.textContent = sound.artist || 'جاهز للاستخدام في المشروع';
    if (card) card.hidden = false;
    const homeCard = $('#studioHomeSourceReady'), homeTitle = $('#studioHomeSourceTitle'), homeArtist = $('#studioHomeSourceArtist');
    if (homeTitle) homeTitle.textContent = sound.title || 'صوت الريلز جاهز';
    if (homeArtist) homeArtist.textContent = sound.artist || 'تم إرفاق الصوت بالمشروع';
    if (homeCard) homeCard.hidden = false;
    const audioTools = $('#studioAudioTools'); if (audioTools) { audioTools.classList.add('has-source'); audioTools.open = true; }
    status('تم إرفاق الصوت بالمشروع. سيظل خاضعًا لصلاحية استخدام الصوت الأصلي.');
  }

  function splitSelected() {
    const clip = selected(); if (!clip || clip.kind !== 'video') { status('اختار فيديو لتقسيمه.'); return; }
    const previewTime = Number($('#studioPreviewVideo')?.currentTime);
    const timeline = window.EgyBookStudioWorkbench?.getTimeline?.();
    const timelineEntry = timeline?.clips?.find(item => item.id === clip.id);
    const timelineTime = Number(timeline?.currentTime);
    const speed = Math.max(.25, Number(clip.speed || 1));
    const timelinePoint = timelineEntry && Number.isFinite(timelineTime)
      ? Number(clip.in || 0) + (timelineTime - timelineEntry.start) * speed
      : NaN;
    const playheadIsInsideSelected = Number.isFinite(timelinePoint)
      && timelinePoint > Number(clip.in || 0) + .15
      && timelinePoint < Number(clip.out ?? clip.duration) - .15;
    const point = Number($('#studioSplitAt')?.value || (playheadIsInsideSelected
      ? timelinePoint
      : (Number.isFinite(previewTime) && previewTime > clip.in && previewTime < clip.out ? previewTime : ((clip.in + clip.out) / 2))));
    if (!Number.isFinite(point) || point <= clip.in + .15 || point >= clip.out - .15) { status('نقطة التقسيم قريبة جدًا من بداية المقطع أو نهايته.'); return; }
    const second = { ...clip, id: uid(), name: `${clip.name} · الجزء 2`, in: point, source: 'split' };
    clip.name = `${clip.name} · الجزء 1`; clip.out = point; state.clips.splice(state.clips.indexOf(clip) + 1, 0, second); renderTimeline(); markDirty();
    status('تم تقسيم المقطع عند موضع المؤشر الأبيض داخل الخط الزمني. الملف الأصلي لم يتغير.');
  }

  function applyText() {
    const value = $('#studioOverlayText')?.value.trim(); const overlay = $('#studioTextOverlay');
    if (!overlay) return;
    overlay.textContent = value; overlay.hidden = !value;
    state.overlays = value ? [{ type: 'text', text: value }] : []; markDirty();
    status(value ? 'تمت إضافة النص إلى معاينة المشروع.' : 'تمت إزالة النص من المعاينة.');
  }

  function exportCurrent() {
    if (!state.clips.length) { status('أضف وسائط قبل التصدير.', 'warn'); return; }
    const clip = state.clips[0];
    const settings = state.settings;
    const projectHasUnrenderedEdits = state.clips.length !== 1
      || state.audioTracks.length > 0 || !!state.sourceSound || state.overlays.length > 0
      || clip.in > 0 || clip.out < clip.duration || Number(clip.speed || 1) !== 1
      || settings.filter !== 'none' || settings.rotation !== 0 || settings.zoom !== 1
      || settings.aspect !== '9:16' || settings.brightness !== 100
      || settings.contrast !== 100 || settings.saturation !== 100
      || settings.transition !== 'cut' || settings.audioVolume !== 100 || settings.audioTrim !== 0;
    if (projectHasUnrenderedEdits) {
      status('تم تجهيز خط الزمن وحفظ إعداداته. تصدير الدمج مع القص أو الصوت أو المؤثرات يحتاج محرك ترميز متعدد المسارات؛ لم يتم إنشاء ملف غير مكتمل أو وهمي.', 'warn');
      return;
    }
    const anchor = document.createElement('a'); anchor.href = clip.url; anchor.download = clip.name.replace(/[\\/:*?"<>|]/g, '_') || 'egybook-studio-media'; document.body.append(anchor); anchor.click(); anchor.remove();
    status('تم تنزيل الملف الأصلي. لم تُطبّق عليه تحويلات غير مصدّرة.');
  }

  function resetProject() {
    revokeClipUrls();
    state.clips = []; state.selectedId = null; state.audioTracks = []; state.sourceSound = null; state.overlays = []; state.currentProjectId = null;
    state.settings = { speed: 1, aspect: '9:16', rotation: 0, zoom: 1, filter: 'none', brightness: 100, contrast: 100, saturation: 100, transition: 'cut', exportQuality: 1080, exportFps: 30, audioVolume: 100, audioTrim: 0 };
    const video = $('#studioPreviewVideo'), image = $('#studioPreviewImage'), empty = $('#studioPreviewEmpty');
    if (video) { video.pause(); video.controls = false; video.removeAttribute('controls'); video.removeAttribute('src'); delete video.dataset.clipId; video.load(); video.hidden = true; }
    if (image) { image.removeAttribute('src'); image.hidden = true; }
    if (empty) empty.hidden = false;
    const sourceCard = $('#studioSoundSourceCard'), homeCard = $('#studioHomeSourceReady'), sourceVideo = $('#studioSourceAudioVideo');
    const reelExtractButton = $('#studioExtractReelSoundButton');
    if (sourceCard) sourceCard.hidden = true; if (homeCard) homeCard.hidden = true; if (reelExtractButton) reelExtractButton.hidden = true;
    const audioTools = $('#studioAudioTools'); if (audioTools) { audioTools.classList.remove('has-source'); audioTools.open = false; }
    if (sourceVideo) { sourceVideo.pause(); sourceVideo.controls = false; sourceVideo.removeAttribute('controls'); sourceVideo.removeAttribute('src'); sourceVideo.load(); }
    const name = $('#studioProjectName'); if (name) name.value = 'مشروع جديد';
    const audioPreview = $('#studioAudioPreview'); if (audioPreview) { audioPreview.pause(); audioPreview.controls = false; audioPreview.removeAttribute('controls'); audioPreview.removeAttribute('src'); audioPreview.load(); }
    const audioName = $('#studioLocalAudioName'); if (audioName) audioName.textContent = 'لم تتم إضافة مسارات صوتية محلية.';
    const waveform = $('#studioAudioWaveform'); if (waveform) waveform.getContext('2d')?.clearRect(0, 0, waveform.width, waveform.height);
    ['studioBrightness','studioContrast','studioSaturation','studioSpeed','studioTransition','studioExportQuality','studioExportFps','studioAudioVolume','studioAudioTrim','studioAudioTrimEnd'].forEach(id => { const node = $(`#${id}`); if (node) node.value = ({studioBrightness:100,studioContrast:100,studioSaturation:100,studioSpeed:1,studioTransition:'cut',studioExportQuality:1080,studioExportFps:30,studioAudioVolume:100,studioAudioTrim:0,studioAudioTrimEnd:100})[id]; });
    $$('.studio-ratio').forEach(button => button.classList.toggle('is-active', button.dataset.ratio === '9:16'));
    $$('.studio-filter').forEach(button => button.classList.toggle('is-active', button.dataset.studioFilter === 'none' || button.dataset.studioCameraFilter === 'none'));
    const stage = $('#studioPreviewStage'); if (stage) stage.dataset.aspect = '9:16';
    window.EgyBookStudioAudio?.syncTracks?.();
    renderTimeline(); markDirty();
  }

  async function buildProject(title = 'مشروع جديد') {
    return {
      id: state.currentProjectId || `project-${Date.now()}`,
      title: title || 'مشروع جديد', createdAt: Date.now(), updatedAt: Date.now(),
      clips: state.clips.map(({ url, thumbnail, ...clip }) => clip), audioTracks: state.audioTracks.map(({ url, ...track }) => track),
      sourceSound: state.sourceSound, settings: { ...state.settings }, overlays: [...state.overlays]
    };
  }
  async function loadProject(project) {
    revokeClipUrls(); state.clips = (project.clips || []).map(clip => ({ ...clip, url: URL.createObjectURL(clip.file) }));
    state.clips.forEach(captureThumbnail);
    state.audioTracks = (project.audioTracks || []).map(track => ({ ...track, url: track.file ? URL.createObjectURL(track.file) : '' })); state.sourceSound = project.sourceSound || null; state.settings = { ...state.settings, ...(project.settings || {}) }; state.overlays = project.overlays || []; state.currentProjectId = project.id;
    if (state.sourceSound) setSourceSound(state.sourceSound);
    window.EgyBookStudioAudio?.syncTracks?.();
    state.selectedId = state.clips[0]?.id || null; render();
    window.EgyBookStudioAudio?.restore?.();
    window.EgyBookCustomSelects?.syncAll?.();
    status('تم فتح المشروع واستعادة الوسائط المحفوظة محليًا.');
  }

  document.addEventListener('change', event => {
    if (event.target.id === 'studioMediaInput') { addFiles(event.target.files); event.target.value = ''; }
    if (event.target.id === 'studioSpeed') { const clip = selected(); if (!clip) return; clip.speed = Number(event.target.value) || 1; const video = $('#studioPreviewVideo'); if (video) video.playbackRate = clip.speed; window.EgyBookStudioWorkbench?.refresh?.(); markDirty(); }
    if (event.target.id === 'studioTrimStart') { const clip = selected(); if (clip) { clip.in = Math.min(Number(event.target.value) || 0, Math.max(0, clip.out - .1)); event.target.value = String(clip.in); window.EgyBookStudioWorkbench?.refresh?.(); markDirty(); } }
    if (event.target.id === 'studioTrimEnd') { const clip = selected(); if (clip) { clip.out = Math.max(clip.in + .1, Math.min(clip.duration, Number(event.target.value) || clip.duration)); event.target.value = String(clip.out); window.EgyBookStudioWorkbench?.refresh?.(); markDirty(); } }
    if (['studioBrightness', 'studioContrast', 'studioSaturation'].includes(event.target.id)) { const map = { studioBrightness: 'brightness', studioContrast: 'contrast', studioSaturation: 'saturation' }; state.settings[map[event.target.id]] = Number(event.target.value); markDirty(); const video = $('#studioPreviewVideo'); if (video) video.style.filter = filterValue(); const image = $('#studioPreviewImage'); if (image) image.style.filter = filterValue(); }
    if (event.target.id === 'studioTransition') { state.settings.transition = event.target.value; markDirty(); }
    if (event.target.id === 'studioExportQuality') { state.settings.exportQuality = Number(event.target.value) || 1080; markDirty(); }
    if (event.target.id === 'studioExportFps') { state.settings.exportFps = Number(event.target.value) || 30; markDirty(); }
    if (event.target.id === 'studioAudioVolume') { state.settings.audioVolume = Number(event.target.value) || 0; markDirty(); }
    if (event.target.id === 'studioAudioTrim') { state.settings.audioTrim = Number(event.target.value) || 0; markDirty(); }
  });
  document.addEventListener('click', event => {
    const filter = event.target.closest('[data-studio-filter]');
    if (filter) { state.settings.filter = filter.dataset.studioFilter; markDirty(); const clip = selected(); if (clip) showPanel('editor'); const image = $('#studioPreviewImage'), video = $('#studioPreviewVideo'); if (image) image.style.filter = filterValue(); if (video) video.style.filter = filterValue(); $$('.studio-filter').forEach(item => item.classList.toggle('is-active', item === filter)); }
    const ratio = event.target.closest('[data-ratio]');
    if (ratio?.classList.contains('studio-ratio')) { state.settings.aspect = ratio.dataset.ratio; syncControls(); markDirty(); }
    const action = event.target.closest('[data-studio-editor-action]')?.dataset.studioEditorAction;
    if (!action) return;
    if (action === 'import') $('#studioMediaInput')?.click();
    if (action === 'split') splitSelected();
    if (action === 'rotate') { state.settings.rotation = (state.settings.rotation + 90) % 360; markDirty(); const clip = selected(); if (clip) clip.rotation = state.settings.rotation; showPanel('editor'); }
    if (action === 'zoom-in' || action === 'zoom-out') { markDirty(); state.settings.zoom = Math.max(.75, Math.min(1.5, state.settings.zoom + (action === 'zoom-in' ? .1 : -.1))); showPanel('editor'); }
    if (action === 'apply-text') applyText();
    if (action === 'export') exportCurrent();
    if (action === 'save') window.EgyBookStudio?.saveProject();
    if (action === 'clear') { revokeClipUrls(); state.clips = []; state.selectedId = null; render(); markDirty(); }
  });

  window.EgyBookStudioEditor = {
    addFiles, setSourceSound, getState: () => state, getSelected: selected, render,
    buildProject, loadProject, splitSelected, resetProject, status,
    selectClip(id) { if (!state.clips.some(item => item.id === id)) return false; state.selectedId = id; render(); return true; },
    clearSelection() { state.selectedId = null; render(); },
    deleteSelected() { const clip = selected(); if (!clip) return false; state.clips = state.clips.filter(item => item.id !== clip.id); if (clip.url) URL.revokeObjectURL(clip.url); state.selectedId = state.clips[0]?.id || null; render(); markDirty(); return true; },
    moveSelected(delta) { const index = state.clips.findIndex(item => item.id === state.selectedId); const target = index + Number(delta || 0); if (index < 0 || target < 0 || target >= state.clips.length) return false; const [item] = state.clips.splice(index, 1); state.clips.splice(target, 0, item); render(); markDirty(); return true; },
    setSelectedSpeed(value) { const clip = selected(); if (!clip) return false; clip.speed = Math.max(.5, Math.min(2, Number(value) || 1)); const video = $('#studioPreviewVideo'); if (video && clip.kind === 'video') video.playbackRate = clip.speed; syncControls(); markDirty(); return true; },
    addAudioTrack(track) { state.audioTracks.push(track); markDirty(); },
    removeAudioTrack(id) { state.audioTracks = state.audioTracks.filter(track => track.id !== id); markDirty(); },
    markDirty,
    getAudioTracks: () => state.audioTracks, getSourceSound: () => state.sourceSound,
    async exportProject() { exportCurrent(); }
  };
})();
