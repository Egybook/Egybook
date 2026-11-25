/* EgyBook Image Viewer Long-Press Module v244
 * Owns only the photo viewer's long-press/context-menu action.
 */
(() => {
  'use strict';
  if (window.__egybookImageViewerLongPressInstalled) return;
  window.__egybookImageViewerLongPressInstalled = true;
  const viewer = document.getElementById('imageViewer');
  const img = document.getElementById('imageViewerImage');
  const menu = document.getElementById('imageViewerMoreMenu');
  if (!viewer || !img || !menu) return;
  let pressTimer = 0, startX = 0, startY = 0, lastX = 0, lastY = 0;
  const openMenu = () => { menu.hidden = false; };
  const clear = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = 0; };
  img.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clear(); startX = lastX = event.clientX; startY = lastY = event.clientY;
    pressTimer = setTimeout(() => { if (Math.hypot(lastX - startX, lastY - startY) < 12) openMenu(); }, 560);
  }, { passive: true });
  img.addEventListener('pointermove', event => {
    lastX = event.clientX; lastY = event.clientY;
    if (Math.hypot(lastX - startX, lastY - startY) > 12) clear();
  }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => img.addEventListener(type, clear, { passive: true }));
  img.addEventListener('contextmenu', event => { event.preventDefault(); openMenu(); }, { capture: true });
  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#imageViewerMoreMenu') && !event.target?.closest?.('#imageViewer [data-action="image-more"]')) menu.hidden = true;
  });
})();
