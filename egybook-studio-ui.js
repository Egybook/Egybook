/* EgyBook Studio V27.4 — responsive workspace and contextual tools. */
(() => {
  'use strict';
  if (window.EgyBookStudioUI) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const modal = () => $('#egybookStudioModal');
  const sheet = () => $('#studioToolSheet');
  const TITLES = {
    audio: 'الصوت والموسيقى', music: 'الصوت والموسيقى', voiceover: 'التعليق الصوتي',
    text: 'النصوص والعناوين', clip: 'تحرير المقطع', filters: 'الفلاتر والألوان',
    'camera-settings': 'إعدادات الكاميرا', beauty: 'تحسين ملامح الوجه', export: 'تصدير المشروع'
  };
  let activeTool = null;

  function openTool(name = 'audio') {
    const target = name === 'music' || name === 'voiceover' ? 'audio' : name;
    const panel = $(`[data-studio-tool-panel="${target}"]`);
    if (!panel) {
      window.EgyBookStudio?.status?.('الأداة دي مش متاحة في النسخة الحالية.', 'warn');
      return false;
    }
    const layer = sheet();
    if (!layer) return false;
    activeTool = target;
    $$('.studio-tool-panel', layer).forEach(item => { item.hidden = item !== panel; });
    $('#studioToolSheetTitle').textContent = TITLES[name] || TITLES[target] || 'أدوات الاستوديو';
    layer.hidden = false;
    layer.dataset.activeTool = target;
    layer.setAttribute('aria-hidden', 'false');
    if (target === 'audio') {
      const details = $('#studioAudioTools');
      if (details) details.classList.add('is-open');
    }
    requestAnimationFrame(() => {
      const focusable = panel.querySelector('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      focusable?.focus?.({ preventScroll: true });
    });
    return true;
  }

  function closeTool() {
    const layer = sheet();
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    activeTool = null;
  }

  function canShareOriginal(state) {
    if (!state || state.clips?.length !== 1 || state.audioTracks?.length || state.sourceSound || state.overlays?.length) return false;
    const clip = state.clips[0], settings = state.settings || {};
    return !!clip?.file && Number(clip.in || 0) <= 0.001
      && Number(clip.out ?? clip.duration ?? 0) >= Number(clip.duration || 0) - 0.02
      && Number(clip.speed || 1) === 1 && Number(clip.rotation || 0) === 0
      && (settings.filter || 'none') === 'none'
      && Number(settings.rotation || 0) === 0 && Number(settings.zoom ?? 1) === 1
      && (settings.aspect || '9:16') === '9:16'
      && Number(settings.brightness ?? 100) === 100
      && Number(settings.contrast ?? 100) === 100
      && Number(settings.saturation ?? 100) === 100
      && Number(settings.speed ?? 1) === 1
      && Number(settings.audioVolume ?? 100) === 100
      && Number(settings.audioTrim ?? 0) === 0
      && (settings.transition || 'cut') === 'cut';
  }

  async function shareOriginalToEgyBook() {
    const state = window.EgyBookStudioEditor?.getState?.();
    if (!state?.clips?.length) { window.EgyBookStudio?.status?.('أضف صورة أو فيديو قبل المشاركة.', 'warn'); return; }
    if (!canShareOriginal(state)) {
      window.EgyBookStudio?.status?.('المشاركة المباشرة متاحة حاليًا للملف الأصلي دون تعديلات أو مسارات إضافية. تصدير مشروع متعدد المسارات يحتاج محرك دمج فعليًا.', 'warn');
      return;
    }
    const file = state.clips[0].file;
    const input = file.type?.startsWith('image/') ? $('#photoInput') : file.type?.startsWith('video/') ? $('#videoInput') : null;
    if (!input || typeof DataTransfer === 'undefined') {
      window.EgyBookStudio?.status?.('تعذر تجهيز الملف للمشاركة في هذا المتصفح. استخدم تنزيل الملف ثم أرفقه بالمنشور.', 'error');
      return;
    }
    let transfer;
    try { transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; }
    catch (_) { window.EgyBookStudio?.status?.('المتصفح لا يسمح بتمرير الملف مباشرة إلى محرر المنشورات.', 'error'); return; }

    const closed = await window.EgyBookStudio?.closeForHandoff?.();
    if (!closed) { window.EgyBookStudio?.status?.('تعذر إغلاق الاستوديو بأمان لفتح محرر المنشورات. حاول مرة أخرى.', 'error'); return; }
    if (!$('#createPostModal')?.classList.contains('open')) {
      const openComposer = $('[data-action="open-post-composer"]');
      if (!openComposer) { window.EgyBookStudio?.status?.('محرر المنشورات غير متاح حاليًا.', 'error'); return; }
      openComposer.click();
    }
    requestAnimationFrame(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  }

  function updateTextLane() {
    const lane = $('#studioTextTrackPreview');
    const source = $('#studioOverlayText');
    if (!lane || !source) return;
    const value = source.value.trim();
    lane.textContent = value || 'لا توجد نصوص بعد';
    lane.classList.toggle('has-content', !!value);
  }

  document.addEventListener('click', event => {
    const tool = event.target.closest('[data-studio-tool]');
    if (tool && !tool.disabled) {
      event.preventDefault();
      openTool(tool.dataset.studioTool);
      return;
    }
    if (event.target.closest('[data-studio-tool-close]')) {
      closeTool();
      return;
    }
    if (event.target.closest('[data-studio-share]')) {
      event.preventDefault();
      void shareOriginalToEgyBook();
      return;
    }
    const duration = event.target.closest('[data-studio-camera-duration]');
    if (duration) {
      const seconds = Number(duration.dataset.studioCameraDuration) || 15;
      $$('.studio-camera-duration [data-studio-camera-duration]').forEach(button => button.classList.toggle('is-active', button === duration));
      window.EgyBookStudioCamera?.setDuration?.(seconds);
      return;
    }
    const mode = event.target.closest('[data-studio-camera-mode]');
    if (mode) {
      if (mode.disabled) return;
      event.preventDefault();
      const value = mode.dataset.studioCameraMode;
      window.EgyBookStudioCamera?.setMode?.(value);
      return;
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'studioOverlayText') updateTextLane();
  });
  document.addEventListener('egybook:studio-dirty', updateTextLane);
  document.addEventListener('egybook:studio-panel-changed', () => {
    const current = modal()?.dataset.screen;
    if (current !== 'camera') return;
    const sound = $('#studioCameraSoundChip');
    if (sound) sound.hidden = !window.EgyBookStudioAudio?.getCurrentTrack?.();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !sheet()?.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeTool();
    }
  }, true);
  window.EgyBookStudioUI = { openTool, closeTool, updateTextLane, getActiveTool: () => activeTool };
})();
