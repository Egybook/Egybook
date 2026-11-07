/* EgyBook v2021 - independent player settings sheets.
   UI-only integration: does not replace the existing playback engine. */
(() => {
  'use strict';
  const box = document.getElementById('egybookVideoBox');
  const rail = document.getElementById('evpPostRail');
  if (!box || !rail || box.dataset.v2021SettingsBound === '1') return;
  box.dataset.v2021SettingsBound = '1';

  const player = document.getElementById('egybookVideoPlayer');
  const audio = document.getElementById('egybookVideoAudio');
  const sourceAudio = document.getElementById('egybookVideoSourceAudio');
  const music = document.getElementById('evpMusicInfo');
  const $ = (s, root = document) => root.querySelector(s);

  const row = document.createElement('div');
  row.className = 'evp-audio-tools';
  row.innerHTML = '<button type="button" class="evp-audio-tool" data-v2021-mute aria-label="كتم الصوت">◖))</button><button type="button" class="evp-audio-tool" data-v2021-settings aria-label="إعدادات المشغل">•••</button>';
  if (music?.parentNode) music.insertAdjacentElement('afterend', row);
  else rail.append(row);

  const sheet = document.createElement('div');
  sheet.className = 'evp-settings-backdrop';
  sheet.hidden = true;
  sheet.innerHTML = `
    <section class="evp-settings-sheet" role="dialog" aria-modal="true" aria-label="إعدادات المشغل" dir="rtl">
      <div class="evp-settings-handle" aria-label="اسحب لأسفل للإغلاق"></div>
      <header><strong data-v2021-sheet-title>إعدادات الفيديو</strong><button type="button" data-v2021-close aria-label="إغلاق">×</button></header>
      <div class="evp-settings-content" data-v2021-sheet-content></div>
    </section>`;
  box.append(sheet);
  const content = $('[data-v2021-sheet-content]', sheet);
  const title = $('[data-v2021-sheet-title]', sheet);
  const close = () => { sheet.classList.remove('is-open'); setTimeout(() => { sheet.hidden = true; }, 220); };
  const open = (name, html) => {
    title.textContent = name;
    content.innerHTML = html;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  };
  const isMuted = () => [player, audio, sourceAudio].filter(Boolean).every(m => m.muted);
  const syncMute = () => {
    const muted = isMuted();
    const button = $('[data-v2021-mute]', row);
    button.textContent = muted ? '◖×' : '◖))';
    button.setAttribute('aria-label', muted ? 'إلغاء كتم الصوت' : 'كتم الصوت');
    button.setAttribute('aria-pressed', String(muted));
  };
  $('[data-v2021-mute]', row).addEventListener('click', () => {
    const next = !isMuted();
    [player, audio, sourceAudio].filter(Boolean).forEach(m => { m.muted = next; });
    syncMute();
  });
  $('[data-v2021-settings]', row).addEventListener('click', () => {
    open('إعدادات المشغل', `
    <button class="evp-settings-item" type="button" data-v2021-quality>إعدادات الجودة <span>›</span></button>
    <label class="evp-settings-toggle"><span><strong>توفير بيانات الاتصال</strong><small>تقليل التحميل المسبق للوسائط عند توفر ذلك</small></span><input type="checkbox" data-v2021-saver></label>
  `);
    const toggle = $('[data-v2021-saver]', content);
    if (toggle) { try { toggle.checked = localStorage.getItem('egybook_data_saver') === '1'; } catch (_) {} }
  });
  sheet.addEventListener('click', event => {
    if (event.target === sheet || event.target.closest('[data-v2021-close]')) { close(); return; }
    if (event.target.closest('[data-v2021-quality]')) {
      open('الجودة', `
        <button class="evp-settings-item is-selected" type="button" data-v2021-quality-choice="auto">تلقائي (حسب المصدر) <span>✓</span></button>
        <p class="evp-settings-help">اختيارات 1080p و720p وغيرها تحتاج نسخ جودة متعددة من مصدر الفيديو. المصدر الحالي لا يوفّر بيانات تؤكد وجود هذه النسخ، لذلك لم نعرض خيارات غير قابلة للتطبيق.</p>
      `);
      return;
    }
    if (event.target.matches('[data-v2021-saver]')) {
      const enabled = event.target.checked;
      try { localStorage.setItem('egybook_data_saver', enabled ? '1' : '0'); } catch (_) {}
      // Only adjust future preload hints; never pause or replace active media.
      [player, audio, sourceAudio].filter(Boolean).forEach(media => {
        if (media === player) media.preload = enabled ? 'metadata' : 'auto';
        else media.preload = enabled ? 'none' : 'metadata';
      });
    }
  });
  sheet.addEventListener('change', event => {
    if (event.target.matches('[data-v2021-saver]')) {
      const enabled = event.target.checked;
      try { localStorage.setItem('egybook_data_saver', enabled ? '1' : '0'); } catch (_) {}
      [player, audio, sourceAudio].filter(Boolean).forEach(media => {
        if (media === player) media.preload = enabled ? 'metadata' : 'auto';
        else media.preload = enabled ? 'none' : 'metadata';
      });
    }
  });
  sheet.addEventListener('click', event => {
    if (event.target.matches('[data-v2021-saver]')) return;
  });
  const savedSaver = (() => { try { return localStorage.getItem('egybook_data_saver') === '1'; } catch (_) { return false; } })();
  const showSettings = sheet.querySelector('[data-v2021-saver]');
  if (showSettings) showSettings.checked = savedSaver;
  if (savedSaver) [player, audio, sourceAudio].filter(Boolean).forEach(media => { media.preload = media === player ? 'metadata' : 'none'; });
  [player, audio, sourceAudio].filter(Boolean).forEach(media => media.addEventListener('volumechange', syncMute));
  syncMute();

  // Drag the bottom sheet with the finger; taps on its content remain usable.
  const handle = $('.evp-settings-handle', sheet);
  let drag = null;
  handle.addEventListener('pointerdown', event => { drag = { y: event.clientY, last: event.clientY }; handle.setPointerCapture?.(event.pointerId); });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.last = event.clientY;
    const delta = Math.max(0, drag.last - drag.y);
    $('.evp-settings-sheet', sheet).style.transform = `translateY(${delta}px)`;
  });
  const finishDrag = () => {
    if (!drag) return;
    const delta = drag.last - drag.y;
    drag = null;
    const panel = $('.evp-settings-sheet', sheet);
    panel.style.transform = '';
    if (delta > 85) close();
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => handle.addEventListener(type, finishDrag));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !sheet.hidden) close(); });

  // Tapping the visible media area closes the video-comments drawer. Movement is
  // ignored so the comments sheet and the media queue keep their swipe gestures.
  let commentTap = null;
  box.addEventListener('pointerdown', event => {
    const comments = document.getElementById('commentsModal');
    if (!comments?.classList.contains('evp-comments-overlay') || comments.hidden) return;
    if (event.target.closest('.comments-modal,.evp-post-rail,.evp-controls,.evp-top-actions,button')) return;
    commentTap = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, true);
  box.addEventListener('pointermove', event => {
    if (!commentTap || commentTap.id !== event.pointerId) return;
    if (Math.abs(event.clientX - commentTap.x) > 10 || Math.abs(event.clientY - commentTap.y) > 10) commentTap.moved = true;
  }, true);
  box.addEventListener('pointerup', event => {
    if (!commentTap || commentTap.id !== event.pointerId) return;
    const tap = commentTap; commentTap = null;
    if (tap.moved) return;
    const comments = document.getElementById('commentsModal');
    if (comments?.classList.contains('evp-comments-overlay') && !comments.hidden) {
      comments.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }, true);
})();
