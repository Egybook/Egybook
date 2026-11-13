/* EgyBook Studio — isolated screen controller and source-aware navigation. */
(() => {
  'use strict';
  if (window.EgyBookStudio) return;
  const $ = selector => document.querySelector(selector);
  const modal = () => $('#egybookStudioModal');
  let historyActive = false, closingFromHistory = false, openedFrom = null, projectTitle = 'مشروع جديد';
  function status(message, kind = 'info') {
    // Routine status chatter stays silent; only actionable warnings/errors are surfaced.
    if (!['warn', 'error'].includes(kind)) return;
    const node = $('#studioStatus'); if (!node) return;
    node.textContent = message; node.dataset.kind = kind; node.hidden = false;
    clearTimeout(node.__hideTimer);
    node.__hideTimer = setTimeout(() => { node.hidden = true; }, kind === 'error' ? 6500 : 4200);
  }
  function switchTab(name) {
    window.EgyBookStudioUI?.closeTool?.();
    const layer = modal(); if (layer) layer.dataset.screen = name;
    $$('[data-studio-panel]').forEach(panel => { panel.hidden = panel.dataset.studioPanel !== name; });
    $$('[data-studio-tab]').forEach(tab => { const active = tab.dataset.studioTab === name; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); });
    if (name === 'projects') refreshProjects();
    if (name === 'camera' && !window.EgyBookStudioCamera?.isActive?.()) window.EgyBookStudioCamera?.startCamera?.();
    if (name !== 'camera' && window.EgyBookStudioCamera?.isActive?.() && !window.EgyBookStudioCamera?.isRecording?.()) window.EgyBookStudioCamera?.stop?.();
    document.dispatchEvent(new Event('egybook:studio-panel-changed'));
  }
  function openTool(name) {
    if (window.EgyBookStudioUI?.openTool?.(name)) {
      document.dispatchEvent(new Event('egybook:studio-panel-changed'));
      return;
    }
    if (name === 'audio') {
      const details = $('#studioAudioTools');
      if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
    document.dispatchEvent(new Event('egybook:studio-panel-changed'));
  }
  const $$ = selector => [...document.querySelectorAll(selector)];
  async function open(detail = {}) {
    const layer = modal(); if (!layer) return;
    const wasOpen = layer.classList.contains('open');
    openedFrom = detail.origin || 'direct';
    if (!wasOpen && !detail.project) {
      window.EgyBookStudioCamera?.stop();
      window.EgyBookStudioAudio?.cleanup();
      window.EgyBookStudioEditor?.resetProject();
    }
    layer.hidden = false; layer.classList.add('open'); layer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.dispatchEvent(new Event('egybook:studio-opened'));
    if (!historyActive) { try { history.pushState({ ...(history.state || {}), egybookStudio: true }, '', location.href); historyActive = true; } catch (_) { historyActive = false; } }
    if (detail.audioSource) {
      window.EgyBookStudioEditor?.setSourceSound(detail.audioSource);
      window.EgyBookStudioAudio?.addSource(detail.audioSource);
      switchTab('camera');
    } else switchTab(detail.tab || 'home');
    if (detail.project) await window.EgyBookStudioEditor?.loadProject(detail.project);
    window.EgyBookCustomSelects?.syncAll?.();
    // No top-of-screen welcome/status banners in Studio.
  }
  function hide({ fromHistory = false } = {}) {
    const layer = modal(); if (!layer || layer.hidden) return;
    if (historyActive && !fromHistory && history.state?.egybookStudio) { closingFromHistory = true; history.back(); return; }
    layer.classList.remove('open'); layer.setAttribute('aria-hidden', 'true'); layer.hidden = true;
    document.dispatchEvent(new Event('egybook:studio-closed'));
    historyActive = false; closingFromHistory = false;
    window.EgyBookStudioCamera?.stop(); window.EgyBookStudioAudio?.cleanup();
    if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
  }

  function closeForHandoff() {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener('egybook:studio-closed', finish);
        clearTimeout(fallback);
        resolve(!!modal()?.hidden);
      };
      document.addEventListener('egybook:studio-closed', finish, { once: true });
      const fallback = setTimeout(finish, 1600);
      hide();
      if (modal()?.hidden) finish();
    });
  }

  async function saveProject(silent = false) {
    try {
      const title = $('#studioProjectName')?.value.trim() || projectTitle;
      const project = await window.EgyBookStudioEditor.buildProject(title);
      project.id = project.id || `project-${Date.now()}`;
      await window.EgyBookStudioProjects.put(project);
      window.EgyBookStudioEditor.getState().currentProjectId = project.id;
      if (!silent) status('تم حفظ المشروع على هذا الجهاز. يمكنك استكماله من «مشاريعي».');
      await refreshProjects();
    } catch (error) { console.warn('Studio project save failed:', error); status('تعذر حفظ المشروع محليًا. تأكد من أن المتصفح يسمح بالتخزين.', 'error'); }
  }
  async function refreshProjects() {
    const list = $('#studioProjectsList'); if (!list) return;
    list.replaceChildren();
    try {
      const projects = await window.EgyBookStudioProjects.all();
      if (!projects.length) { const empty = document.createElement('p'); empty.className = 'studio-empty'; empty.textContent = 'لا توجد مشاريع محفوظة على هذا الجهاز حتى الآن.'; list.append(empty); return; }
      projects.forEach(project => {
        const row = document.createElement('article'); row.className = 'studio-project-row';
        const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = project.title || 'مشروع بدون اسم'; const meta = document.createElement('small'); meta.textContent = `${(project.clips || []).length} وسيط · ${new Date(project.updatedAt || Date.now()).toLocaleDateString('ar-EG')}`; copy.append(name, meta);
        const openButton = document.createElement('button'); openButton.type = 'button'; openButton.textContent = 'فتح'; openButton.addEventListener('click', async () => { await window.EgyBookStudioEditor.loadProject(project); switchTab('editor'); });
        const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.textContent = 'حذف'; deleteButton.className = 'danger'; deleteButton.addEventListener('click', async () => { await window.EgyBookStudioProjects.remove(project.id); refreshProjects(); });
        row.append(copy, openButton, deleteButton); list.append(row);
      });
    } catch (_) { const warning = document.createElement('p'); warning.className = 'studio-empty'; warning.textContent = 'التخزين المحلي للمشاريع غير متاح في هذا المتصفح.'; list.append(warning); }
  }
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-studio-tab]'); if (tab) switchTab(tab.dataset.studioTab);
    const nav = event.target.closest('[data-studio-go]'); if (nav) { switchTab(nav.dataset.studioGo); if (nav.dataset.studioOpenTool) openTool(nav.dataset.studioOpenTool); if (nav.dataset.studioGo === 'camera') window.EgyBookStudioCamera?.startCamera(); }
    if (event.target.closest('[data-studio-close]')) { hide(); return; }
    if (event.target === modal()) hide();
    if (event.target.closest('[data-studio-save]')) saveProject();
    if (event.target.closest('[data-studio-export]')) window.EgyBookStudioEditor?.exportProject();
    if (event.target.closest('[data-studio-camera-open]')) { switchTab('camera'); }
    if (event.target.closest('[data-studio-import-open]')) { switchTab('editor'); $('#studioMediaInput')?.click(); }
    if (event.target.closest('[data-studio-project-new]')) { window.EgyBookStudioAudio?.cleanup(); window.EgyBookStudioEditor?.resetProject(); window.EgyBookCustomSelects?.syncAll?.(); switchTab('home'); status('تم فتح مشروع جديد.'); }
  });
  let autoSaveTimer = 0;
  document.addEventListener('egybook:studio-dirty', () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      const state = window.EgyBookStudioEditor?.getState();
      if (!modal()?.classList.contains('open') || !state || (!state.clips.length && !state.audioTracks.length && !state.sourceSound)) return;
      await saveProject(true);
      const label = $('#studioAutoSaveLabel'); if (label) label.textContent = 'تم الحفظ تلقائيًا';
    }, 1800);
  });
  document.addEventListener('egybook:studio-open-request', event => open(event.detail || {}));
  document.addEventListener('click', event => {
    const studioButton = event.target.closest('[data-action="composer-studio"]');
    if (!studioButton) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    open({ origin: 'composer-menu' });
  }, true);
  window.addEventListener('popstate', event => {
    if (!modal()?.classList.contains('open')) return;
    historyActive = false; hide({ fromHistory: true });
    event.stopImmediatePropagation(); event.preventDefault?.();
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal()?.classList.contains('open')) { event.preventDefault(); event.stopImmediatePropagation(); hide(); } }, true);
  window.addEventListener('pagehide', () => { window.EgyBookStudioCamera?.stop(); window.EgyBookStudioAudio?.cleanup(); });
  window.EgyBookStudio = { open, close: hide, closeForHandoff, status, switchTab, saveProject, refreshProjects, getOrigin: () => openedFrom };
})();
