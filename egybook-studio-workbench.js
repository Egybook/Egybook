/* EgyBook Studio V27.7 — unified horizontal tools + synchronized multitrack timeline. */
(() => {
  'use strict';
  if (window.EgyBookStudioWorkbench) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const editor = () => window.EgyBookStudioEditor;
  const preview = () => $('#studioPreviewVideo');
  const stack = () => $('#studioTimelineStack');
  const canvas = () => $('#studioTimelineCanvas');
  const ruler = () => $('#studioTimelineRuler');
  const playhead = () => $('#studioTimelinePlayhead');
  let SIDE_GUTTER = 58; // recalculated from the responsive track grid before layout
  const MIN_CLIP_PX = 56;
  const BASE_PPS = 30;
  const state = { globalTime: 0, scale: BASE_PPS, model: [], totalDuration: 0, contentWidth: 0, scrubbing: null, trimming: null, rulerPanning: null, suppressRulerClickUntil: 0, resizeObserver: null, mutationObserver: null, layoutFrame: 0 };

  const timeText = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const clipLength = clip => Math.max(0.1, (Math.max(0, Number(clip.out ?? clip.duration) - Number(clip.in || 0))) / Math.max(0.25, Number(clip.speed || 1)));

  function makeModel() {
    const clips = editor()?.getState?.().clips || [];
    let timeCursor = 0;
    let pixelCursor = 0;
    const entries = clips.map(clip => {
      const duration = clipLength(clip);
      const width = Math.max(MIN_CLIP_PX, duration * state.scale);
      const entry = { clip, duration, startTime: timeCursor, endTime: timeCursor + duration, startPx: pixelCursor, endPx: pixelCursor + width, width };
      timeCursor += duration;
      pixelCursor += width;
      return entry;
    });
    return { entries, duration: timeCursor, pixels: pixelCursor };
  }

  function layout() {
    const root = stack();
    const inner = canvas();
    const timeline = $('#studioTimeline');
    if (!root || !inner || !timeline) return;
    const current = editor()?.getState?.();
    const clips = current?.clips || [];
    const tracks = current?.audioTracks || [];
    const firstRow = $('.studio-track-row', inner);
    if (firstRow) {
      const columns = getComputedStyle(firstRow).gridTemplateColumns.split(/\s+/);
      if (columns.length >= 3) {
        const leftRail = parseFloat(columns[0]);
        const rightRail = parseFloat(columns[columns.length - 1]);
        if (Number.isFinite(leftRail) && Number.isFinite(rightRail)) SIDE_GUTTER = leftRail + rightRail;
      }
    }
    const viewportWidth = Math.max(220, root.clientWidth || root.getBoundingClientRect().width || 320);
    const laneWidth = Math.max(150, viewportWidth - SIDE_GUTTER);
    const totalRunTime = clips.reduce((sum, clip) => sum + clipLength(clip), 0);
    if (!state.trimming) {
      state.scale = totalRunTime > 0
        ? Math.min(140, Math.max(BASE_PPS, laneWidth / totalRunTime))
        : BASE_PPS;
    }

    const model = makeModel();
    const audioWidths = tracks.map(track => {
      const duration = Math.max(0, Number(track.duration || track.mediaDuration || 0));
      return duration ? Math.max(MIN_CLIP_PX, duration * state.scale) : MIN_CLIP_PX;
    });
    const audioPixels = audioWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, audioWidths.length - 1) * 5;
    const contentLaneWidth = Math.max(laneWidth, model.pixels, audioPixels);
    const canvasWidth = contentLaneWidth + SIDE_GUTTER;
    state.model = model.entries;
    state.totalDuration = model.duration;
    state.contentWidth = contentLaneWidth;

    inner.style.width = `${canvasWidth}px`;
    inner.style.minWidth = `${canvasWidth}px`;
    $$('.studio-track-row', inner).forEach(row => { row.style.width = `${canvasWidth}px`; row.style.minWidth = `${canvasWidth}px`; });
    const videoLane = $('#studioTimeline');
    videoLane.style.width = `${contentLaneWidth}px`;
    videoLane.style.minWidth = `${contentLaneWidth}px`;
    videoLane.style.flexBasis = `${contentLaneWidth}px`;
    videoLane.style.setProperty('--studio-timeline-lane-width', `${contentLaneWidth}px`);

    state.model.forEach(entry => {
      const node = [...videoLane.querySelectorAll('.studio-clip[data-clip-id]')].find(item => item.dataset.clipId === entry.clip.id);
      if (!node) return;
      node.style.width = `${entry.width}px`;
      node.style.flex = `0 0 ${entry.width}px`;
      node.style.minWidth = `${Math.min(entry.width, MIN_CLIP_PX)}px`;
      node.dataset.timelineStart = String(entry.startTime);
      node.dataset.timelineEnd = String(entry.endTime);
      node.dataset.timelinePxStart = String(entry.startPx);
      node.dataset.timelinePxEnd = String(entry.endPx);
      const detail = $('.studio-clip-copy small', node);
      if (detail) detail.textContent = `${clips.indexOf(entry.clip) + 1} · ${entry.clip.kind === 'image' ? 'صورة' : timeText(entry.clip.out - entry.clip.in)}`;
      ensureTrimHandles(node);
    });

    const audioList = $('#studioAudioTracksList');
    if (audioList) {
      audioList.style.width = `${contentLaneWidth}px`;
      audioList.style.minWidth = `${contentLaneWidth}px`;
      $$('.studio-audio-track', audioList).forEach((node, index) => {
        if (audioWidths[index]) { node.style.flex = `0 0 ${audioWidths[index]}px`; node.style.width = `${audioWidths[index]}px`; }
      });
    }
    const textTrack = $('#studioTextTrackPreview');
    if (textTrack) { textTrack.style.width = `${contentLaneWidth}px`; textTrack.style.minWidth = `${contentLaneWidth}px`; }

    renderRuler();
    syncRulerScroll();
    updatePlayheadPosition();
  }

  function entryAtTime(value) {
    if (!state.model.length) return null;
    const time = clamp(value, 0, state.totalDuration);
    return state.model.find((entry, index) => time < entry.endTime || index === state.model.length - 1) || state.model[state.model.length - 1];
  }

  function entryAtPixel(value) {
    if (!state.model.length) return null;
    const pixel = clamp(value, 0, state.model[state.model.length - 1].endPx);
    return state.model.find((entry, index) => pixel < entry.endPx || index === state.model.length - 1) || state.model[state.model.length - 1];
  }

  function pixelForTime(value) {
    const entry = entryAtTime(value);
    if (!entry) return 0;
    const ratio = clamp((value - entry.startTime) / entry.duration, 0, 1);
    return entry.startPx + ratio * entry.width;
  }

  function timeForPixel(value) {
    const entry = entryAtPixel(value);
    if (!entry) return 0;
    const ratio = clamp((value - entry.startPx) / entry.width, 0, 1);
    return entry.startTime + ratio * entry.duration;
  }

  function renderRuler() {
    const rulerNode = ruler();
    if (!rulerNode) return;
    rulerNode.replaceChildren();
    const width = state.contentWidth + SIDE_GUTTER;
    rulerNode.style.width = `${width}px`;
    rulerNode.style.minWidth = `${width}px`;
    const interval = state.totalDuration > 180 ? 15 : state.totalDuration > 70 ? 10 : state.totalDuration > 24 ? 5 : 2;
    const ticks = Math.max(1, Math.ceil(state.totalDuration / interval));
    for (let index = 0; index <= ticks; index += 1) {
      const seconds = Math.min(state.totalDuration, index * interval);
      if (index === ticks && seconds < state.totalDuration) continue;
      const tick = document.createElement('span');
      tick.className = 'studio-ruler-tick';
      tick.style.left = `${SIDE_GUTTER / 2 + pixelForTime(seconds)}px`;
      tick.textContent = timeText(seconds);
      rulerNode.append(tick);
    }
    if (!state.totalDuration) {
      const tick = document.createElement('span');
      tick.className = 'studio-ruler-tick';
      tick.style.left = `${SIDE_GUTTER / 2}px`;
      tick.textContent = '00:00';
      rulerNode.append(tick);
    }
  }

  function syncRulerScroll() {
    const root = stack();
    const rulerNode = ruler();
    if (!root || !rulerNode) return;
    rulerNode.style.transform = `translate3d(${-root.scrollLeft}px,0,0)`;
  }

  function updatePlayheadPosition() {
    const line = playhead();
    if (!line) return;
    const x = SIDE_GUTTER / 2 + pixelForTime(state.globalTime);
    line.style.left = `${x}px`;
    line.setAttribute('aria-valuemax', String(Math.round(state.totalDuration * 100)));
    line.setAttribute('aria-valuenow', String(Math.round(state.globalTime * 100)));
    const label = $('#studioPlayheadTime');
    if (label) label.textContent = timeText(state.globalTime);
  }

  function ensurePlayheadVisible() {
    const root = stack();
    if (!root) return;
    const x = SIDE_GUTTER / 2 + pixelForTime(state.globalTime);
    const left = root.scrollLeft;
    const right = left + root.clientWidth;
    if (x < left + 24) root.scrollLeft = Math.max(0, x - 24);
    else if (x > right - 24) root.scrollLeft = Math.min(root.scrollWidth, x - root.clientWidth + 24);
    syncRulerScroll();
  }

  function seekToGlobalTime(value, { scroll = false, pause = false } = {}) {
    const instance = editor();
    const clips = instance?.getState?.().clips || [];
    if (!clips.length) {
      state.globalTime = 0;
      updatePlayheadPosition();
      return;
    }
    const time = clamp(value, 0, state.totalDuration);
    state.globalTime = time;
    let entry = entryAtTime(time);
    if (!entry) return;
    const current = instance.getSelected?.();
    if (!current || current.id !== entry.clip.id) {
      instance.selectClip(entry.clip.id);
      // Selection renders the track again; keep the lane model synchronized.
      layout();
      state.globalTime = time;
      entry = entryAtTime(time) || entry;
    }
    const video = preview();
    if (video && entry.clip.kind === 'video') {
      const local = clamp(entry.clip.in + (time - entry.startTime) * Math.max(0.25, Number(entry.clip.speed || 1)), Number(entry.clip.in || 0), Number(entry.clip.out ?? entry.clip.duration));
      if (video.readyState >= 1) {
        try { video.currentTime = local; } catch (_) { /* The browser may still be preparing the media. */ }
      } else {
        video.dataset.studioPendingTimelineSeek = String(local);
        video.dataset.studioPendingTimelineClip = entry.clip.id;
        if (video.dataset.studioTimelineSeekListener !== '1') {
          video.dataset.studioTimelineSeekListener = '1';
          video.addEventListener('loadedmetadata', () => {
            const pending = Number(video.dataset.studioPendingTimelineSeek);
            if (video.dataset.clipId === video.dataset.studioPendingTimelineClip && Number.isFinite(pending)) {
              try { video.currentTime = pending; } catch (_) { /* Ignore an unsupported early seek. */ }
            }
            delete video.dataset.studioPendingTimelineSeek;
            delete video.dataset.studioPendingTimelineClip;
            delete video.dataset.studioTimelineSeekListener;
          }, { once: true });
        }
      }
      if (pause && !video.paused) video.pause();
    }
    updatePlayheadPosition();
    if (scroll) ensurePlayheadVisible();
    window.EgyBookStudioPlayer?.refresh?.();
  }

  function updateFromPreview() {
    const selected = editor()?.getSelected?.();
    const video = preview();
    if (!selected || selected.kind !== 'video' || !video || !Number.isFinite(video.currentTime)) return;
    const entry = state.model.find(item => item.clip.id === selected.id);
    if (!entry) return;
    state.globalTime = clamp(entry.startTime + (video.currentTime - Number(selected.in || 0)) / Math.max(0.25, Number(selected.speed || 1)), entry.startTime, entry.endTime);
    updatePlayheadPosition();
  }

  function localXToGlobal(clientX) {
    const root = stack();
    if (!root) return 0;
    const rect = root.getBoundingClientRect();
    const pixel = clientX - rect.left + root.scrollLeft - SIDE_GUTTER / 2;
    return timeForPixel(pixel);
  }

  function autoScrollAt(clientX) {
    const root = stack();
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const edge = 34;
    if (clientX < rect.left + edge) root.scrollLeft = Math.max(0, root.scrollLeft - 14);
    else if (clientX > rect.right - edge) root.scrollLeft = Math.min(root.scrollWidth, root.scrollLeft + 14);
    syncRulerScroll();
  }

  function beginScrub(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const root = stack();
    if (!root || !state.model.length) return;
    event.preventDefault();
    event.stopPropagation();
    const video = preview();
    if (video && !video.paused) video.pause();
    state.scrubbing = { pointerId: event.pointerId };
    try { (event.currentTarget || playhead()).setPointerCapture?.(event.pointerId); } catch (_) {}
    seekToGlobalTime(localXToGlobal(event.clientX), { pause: true });
  }

  function moveScrub(event) {
    if (!state.scrubbing || event.pointerId !== state.scrubbing.pointerId) return;
    event.preventDefault();
    autoScrollAt(event.clientX);
    seekToGlobalTime(localXToGlobal(event.clientX), { pause: true });
  }

  function endScrub(event) {
    if (!state.scrubbing || (event.pointerId !== undefined && event.pointerId !== state.scrubbing.pointerId)) return;
    state.scrubbing = null;
  }

  function ensureTrimHandles(node) {
    if (!node || $('.studio-clip-trim-handle', node)) return;
    for (const edge of ['start', 'end']) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `studio-clip-trim-handle studio-clip-trim-${edge}`;
      handle.dataset.studioTrimEdge = edge;
      handle.setAttribute('aria-label', edge === 'start' ? 'سحب لتعديل بداية المقطع' : 'سحب لتعديل نهاية المقطع');
      handle.innerHTML = edge === 'start'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16M13 7v10M5 7h3M5 17h3"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4v16M11 7v10M16 7h3M16 17h3"/></svg>';
      node.append(handle);
    }
  }


  function beginRulerPan(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const root = stack();
    if (!root) return;
    state.rulerPanning = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: root.scrollLeft, moved: false };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_) {}
  }

  function moveRulerPan(event) {
    const pan = state.rulerPanning;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const distance = event.clientX - pan.startX;
    if (!pan.moved && Math.abs(distance) < 5) return;
    pan.moved = true;
    const root = stack();
    if (!root) return;
    root.scrollLeft = Math.max(0, Math.min(root.scrollWidth, pan.startScrollLeft - distance));
    syncRulerScroll();
  }

  function endRulerPan(event) {
    const pan = state.rulerPanning;
    if (!pan || (event?.pointerId !== undefined && event.pointerId !== pan.pointerId)) return;
    if (pan.moved) state.suppressRulerClickUntil = Date.now() + 350;
    state.rulerPanning = null;
  }

  function beginTrim(event) {
    const handle = event.target.closest('.studio-clip-trim-handle');
    if (!handle) return;
    const row = handle.closest('.studio-clip[data-clip-id]');
    const clip = editor()?.getState?.().clips.find(item => item.id === row?.dataset.clipId);
    if (!clip) return;
    event.preventDefault();
    event.stopPropagation();
    state.trimming = {
      pointerId: event.pointerId,
      clipId: clip.id,
      edge: handle.dataset.studioTrimEdge,
      startX: event.clientX,
      originalIn: Number(clip.in || 0),
      originalOut: Number(clip.out ?? clip.duration),
      originalGlobalTime: state.globalTime,
      pixelsPerRunSecond: Math.max(1, row.getBoundingClientRect().width / clipLength(clip)),
      handle
    };
    row.classList.add('is-trimming');
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function moveTrim(event) {
    const drag = state.trimming;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const clip = editor()?.getState?.().clips.find(item => item.id === drag.clipId);
    if (!clip) return;
    const runDelta = (event.clientX - drag.startX) / drag.pixelsPerRunSecond;
    const sourceDelta = runDelta * Math.max(0.25, Number(clip.speed || 1));
    const minLength = 0.12;
    if (drag.edge === 'start') {
      clip.in = clamp(drag.originalIn + sourceDelta, 0, drag.originalOut - minLength);
    } else {
      clip.out = clamp(drag.originalOut + sourceDelta, drag.originalIn + minLength, Number(clip.duration) || drag.originalOut);
    }
    layout();
  }

  function endTrim(event, commit = true) {
    const drag = state.trimming;
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    state.trimming = null;
    $$('.studio-clip.is-trimming').forEach(node => node.classList.remove('is-trimming'));
    const instance = editor();
    const clip = instance?.getState?.().clips.find(item => item.id === drag.clipId);
    if (!commit && clip) { clip.in = drag.originalIn; clip.out = drag.originalOut; }
    if (clip) {
      instance.selectClip(clip.id);
      if (commit) instance.markDirty?.();
    }
    state.globalTime = clamp(drag.originalGlobalTime, 0, state.totalDuration);
    layout();
    updatePlayheadPosition();
  }

  function onTimelineClick(event) {
    const clipNode = event.target.closest('.studio-clip[data-clip-id]');
    if (clipNode && !event.target.closest('.studio-clip-trim-handle')) {
      const entry = state.model.find(item => item.clip.id === clipNode.dataset.clipId);
      if (entry) seekToGlobalTime(entry.startTime, { pause: true });
      return;
    }
    if (event.target.closest('button, .studio-playhead')) return;
    if (event.target.closest('.studio-timeline, .studio-audio-tracks, .studio-text-track')) {
      seekToGlobalTime(localXToGlobal(event.clientX), { pause: true });
    }
  }

  function bind() {
    const root = stack();
    const rulerNode = ruler();
    const line = playhead();
    const timeline = $('#studioTimeline');
    if (!root || !canvas() || !line || !timeline) return;

    root.addEventListener('scroll', syncRulerScroll, { passive: true });
    root.addEventListener('pointerdown', event => {
      if (event.target.closest('.studio-clip-trim-handle')) beginTrim(event);
      // Leave the track surface's horizontal pan gesture to the browser. The
      // playhead itself is the explicit drag target for precise scrubbing.
    });
    line.addEventListener('pointerdown', beginScrub);
    line.addEventListener('keydown', event => {
      if (!state.model.length) return;
      let next = state.globalTime;
      if (event.key === 'ArrowLeft') next -= event.shiftKey ? 1 : 0.1;
      else if (event.key === 'ArrowRight') next += event.shiftKey ? 1 : 0.1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = state.totalDuration;
      else return;
      event.preventDefault();
      seekToGlobalTime(next, { scroll: true, pause: true });
    });
    const rulerViewport = rulerNode?.parentElement;
    rulerViewport?.addEventListener('pointerdown', beginRulerPan);
    rulerNode?.addEventListener('click', event => {
      if (Date.now() < state.suppressRulerClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
      seekToGlobalTime(localXToGlobal(event.clientX), { pause: true });
    });
    root.addEventListener('click', onTimelineClick);
    document.addEventListener('pointermove', event => { moveScrub(event); moveTrim(event); moveRulerPan(event); }, { passive: false });
    document.addEventListener('pointerup', event => { endScrub(event); endTrim(event, true); endRulerPan(event); });
    document.addEventListener('pointercancel', event => { endScrub(event); endTrim(event, false); endRulerPan(event); });

    const video = preview();
    video?.addEventListener('timeupdate', updateFromPreview);
    video?.addEventListener('seeked', updateFromPreview);
    document.addEventListener('egybook:studio-timeline-rendered', layout);
    document.addEventListener('egybook:studio-selection-changed', () => { updateFromPreview(); layout(); });
    document.addEventListener('egybook:studio-closed', () => { state.scrubbing = null; state.trimming = null; state.rulerPanning = null; });
    document.addEventListener('egybook:studio-panel-changed', layout);

    if (window.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(() => layout());
      state.resizeObserver.observe(root);
      const content = $('#studioEditorToolsRail');
      if (content) state.resizeObserver.observe(content);
    }
    const clipList = $('#studioTimeline');
    if (window.MutationObserver && clipList) {
      state.mutationObserver = new MutationObserver(() => layout());
      state.mutationObserver.observe(clipList, { childList: true, subtree: true });
      const audioList = $('#studioAudioTracksList');
      if (audioList) state.mutationObserver.observe(audioList, { childList: true, subtree: true });
    }
    window.addEventListener('resize', layout, { passive: true });
    layout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();

  window.EgyBookStudioWorkbench = {
    refresh: layout,
    seek: seekToGlobalTime,
    getTimeline: () => ({ currentTime: state.globalTime, duration: state.totalDuration, scale: state.scale, clips: state.model.map(entry => ({ id: entry.clip.id, start: entry.startTime, end: entry.endTime, x: entry.startPx, width: entry.width })) })
  };
})();
