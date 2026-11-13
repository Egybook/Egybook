/* EgyBook Studio V27.5 — contextual editing dock for video/audio/text tracks. */
(() => {
  'use strict';
  if (window.EgyBookStudioEditorUI) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const actionsRoot = () => $('#studioEditorContextActions');
  const state = { type: 'general', id: null };
  const icon = id => `<svg class="studio-icon" aria-hidden="true"><use href="#ebs-${id}"></use></svg>`;
  const button = (label, symbol, action, disabled = false, extra = '') =>
    `<button type="button" class="studio-context-action${disabled ? ' is-unavailable' : ''}" data-studio-context-action="${action}" ${disabled ? 'disabled aria-disabled="true"' : ''} ${extra}>
      ${icon(symbol)}<small>${label}</small></button>`;

  function draw(type = 'general', id = null) {
    state.type = type; state.id = id;
    const root = actionsRoot(); if (!root) return;
    const title = $('#studioContextTitle');
    const hint = $('#studioContextHint');
    let html = '';
    if (type === 'general') {
      if (title) title.textContent = 'أدوات عامة';
      if (hint) hint.textContent = 'اختر أداة لإضافتها إلى المشروع';
      html = [
        button('موسيقى', 'music', 'tool:audio'),
        button('نص', 'edit', 'tool:text'),
        button('تعليق صوتي', 'mic', 'tool:voiceover'),
        button('الشروح التلقائية', 'caption', 'tool:captions', true, 'title="يتطلب محرك تعرف على الكلام"'),
        button('الملصقات', 'sticker', 'tool:stickers', true, 'title="أداة الملصقات غير مفعلة بعد"'),
        button('الفلاتر', 'filter', 'tool:filters'),
        button('التأثيرات', 'effects', 'tool:effects', true, 'title="معالجة التأثيرات غير مفعلة بعد"'),
        button('تصدير', 'export', 'tool:export')
      ].join('');
    } else if (type === 'video') {
      if (title) title.textContent = 'أدوات المقطع المحدد';
      if (hint) hint.textContent = 'تم تحديد مقطع فيديو أو صورة في الخط الزمني';
      html = [
        button('حذف', 'trash', 'clip:delete'),
        button('تحريك لليسار', 'back', 'clip:move-prev'),
        button('تحريك لليمين', 'next', 'clip:move-next'),
        button('مستوى الصوت', 'volume', 'clip:volume', true, 'title="التحكم في صوت كل مقطع غير متاح بعد"'),
        button('السرعة والقص', 'speed', 'clip:settings'),
        button('اقتصاص', 'crop', 'clip:crop'),
        button('تقسيم', 'cut', 'clip:split'),
        button('استبدال', 'replace', 'clip:replace', true, 'title="استبدال المقطع لم يتم ربطه بعد"'),
        button('استخراج الصوت', 'music', 'clip:extract-audio'),
        button('تأثيرات صوتية', 'wave', 'clip:sound-effects', true),
        button('تحسين الصوت', 'adjust', 'clip:enhance-audio', true)
      ].join('');
    } else if (type === 'audio') {
      if (title) title.textContent = 'أدوات المسار الصوتي';
      if (hint) hint.textContent = 'حدد مسارًا صوتيًا لإدارته';
      html = [
        button('إعدادات الصوت', 'adjust', 'audio:settings'),
        button('قص الصوت', 'crop', 'audio:trim'),
        button('حذف', 'trash', 'audio:delete'),
        button('مستوى الصوت', 'volume', 'audio:volume'),
        button('تحريك البداية', 'transition', 'audio:position', true, 'title="تحريك توقيت المسار داخل الخط الزمني قيد التطوير"'),
        button('استبدال', 'replace', 'audio:replace', true),
        button('تلاشي تدريجي', 'wave', 'audio:fade', true, 'title="Fade In/Out غير منفذ بعد"')
      ].join('');
    } else if (type === 'text') {
      if (title) title.textContent = 'أدوات النص المحدد';
      if (hint) hint.textContent = 'تحرير النص الحالي في المعاينة';
      html = [
        button('تعديل النص', 'edit', 'text:edit'),
        button('الخط', 'adjust', 'text:font', true),
        button('اللون', 'filter', 'text:color', true),
        button('الخلفية', 'layers', 'text:background', true),
        button('الحركة', 'effects', 'text:animation', true),
        button('مدة الظهور', 'timer', 'text:duration', true),
        button('حذف النص', 'trash', 'text:delete')
      ].join('');
    } else if (type === 'transition') {
      if (title) title.textContent = 'إعدادات الانتقال';
      if (hint) hint.textContent = 'مؤثرات الانتقال تحتاج دعمًا داخل محرك التصدير قبل تفعيلها';
      html = [
        button('تلاشي', 'transition', 'transition:fade', true),
        button('انتقال جانبي', 'next', 'transition:slide', true),
        button('تكبير وتصغير', 'expand', 'transition:zoom', true),
        button('حركات', 'effects', 'transition:motion', true),
        button('المدة', 'timer', 'transition:duration', true)
      ].join('');
    } else if (type === 'sticker') {
      if (title) title.textContent = 'أدوات الملصق';
      if (hint) hint.textContent = 'مسارات الملصقات غير متاحة في محرك التحرير الحالي';
      html = button('الملصقات غير متاحة', 'sticker', 'sticker:unavailable', true);
    }
    root.innerHTML = html;
    root.dataset.contextType = type;
  }

  function selectAudio(row) {
    document.querySelectorAll('.studio-audio-track.is-context-selected').forEach(node => node.classList.remove('is-context-selected'));
    row.classList.add('is-context-selected');
    draw('audio', row.dataset.audioTrackId || null);
  }

  document.addEventListener('egybook:studio-selection-changed', event => {
    draw(event.detail?.type || 'general', event.detail?.id || null);
  });
  document.addEventListener('egybook:studio-transition-selected', () => draw('transition'));

  // Keep the visible playhead timestamp synchronized with the preview clock.
  const previewVideo = $('#studioPreviewVideo');
  const playheadLabel = $('#studioPlayheadTime');
  const formatTime = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const updatePlayheadClock = () => {
    if (playheadLabel && previewVideo) playheadLabel.textContent = formatTime(previewVideo.currentTime);
  };
  if (previewVideo) {
    ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'emptied'].forEach(type => previewVideo.addEventListener(type, updatePlayheadClock));
  }
  document.addEventListener('egybook:studio-selection-changed', updatePlayheadClock);

  document.addEventListener('click', event => {
    const clip = event.target.closest('.studio-clip[data-clip-id]');
    if (clip && !event.target.closest('button')) {
      // The editor module owns clip selection; its render event will refresh this dock.
      return;
    }
    const audioRow = event.target.closest('.studio-audio-track[data-audio-track-id]');
    if (audioRow && !event.target.closest('button')) { selectAudio(audioRow); return; }
    if (event.target.closest('[data-studio-text-track]')) { draw('text'); return; }
    const contextButton = event.target.closest('[data-studio-context-action]');
    if (!contextButton || contextButton.disabled) return;
    const action = contextButton.dataset.studioContextAction;
    const [scope, command] = action.split(':');
    const editor = window.EgyBookStudioEditor;
    if (scope === 'tool') {
      if (command === 'voiceover') {
        window.EgyBookStudioUI?.openTool?.('audio');
        setTimeout(() => $('[data-studio-audio-action="voice"]')?.click(), 80);
      } else window.EgyBookStudioUI?.openTool?.(command);
    }
    if (scope === 'clip') {
      if (command === 'delete') editor?.deleteSelected?.();
      if (command === 'move-prev') editor?.moveSelected?.(-1);
      if (command === 'move-next') editor?.moveSelected?.(1);
      if (command === 'split') editor?.splitSelected?.();
      if (command === 'settings' || command === 'crop') window.EgyBookStudioUI?.openTool?.('clip');
      if (command === 'extract-audio') {
        window.EgyBookStudioUI?.openTool?.('audio');
        setTimeout(() => $('[data-studio-audio-action="extract"]')?.click(), 80);
      }
    }
    if (scope === 'audio') {
      if (command === 'delete' && state.id) window.EgyBookStudioAudio?.removeTrack?.(state.id);
      else if (command === 'settings' || command === 'trim' || command === 'volume') window.EgyBookStudioUI?.openTool?.('audio');
    }
    if (scope === 'text') {
      if (command === 'edit') window.EgyBookStudioUI?.openTool?.('text');
      if (command === 'delete') {
        const input = $('#studioOverlayText'); if (input) input.value = '';
        $('[data-studio-editor-action="apply-text"]')?.click();
        draw('general');
      }
    }
  });

  // Tapping unused timeline background clears the active selection and restores general tools.
  document.addEventListener('click', event => {
    const area = event.target.closest('.studio-timeline-area');
    if (!area) return;
    if (event.target.closest('.studio-clip, .studio-transition-control, .studio-track-add, .studio-audio-track, [data-studio-text-track]')) return;
    window.EgyBookStudioEditor?.clearSelection?.();
    document.querySelectorAll('.studio-audio-track.is-context-selected').forEach(node => node.classList.remove('is-context-selected'));
    draw('general');
  });

  draw('general');
  window.EgyBookStudioEditorUI = { draw, getState: () => ({ ...state }) };
})();
