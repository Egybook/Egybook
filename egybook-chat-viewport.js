/* EgyBook Chat Viewport Module v244
 * Coalesces visual-viewport and keyboard resize work to one update per frame.
 */
(() => {
  'use strict';
  if (window.__egybookChatViewportInstalled) return;
  window.__egybookChatViewportInstalled = true;

  let syncFrame = 0;
  const syncChatViewport = () => {
    syncFrame = 0;
    if (!document.body?.classList.contains('messages-thread-open')) return;
    const vv = window.visualViewport;
    const height = vv?.height || window.innerHeight;
    const value = `${Math.max(240, Math.round(height))}px`;
    if (document.documentElement.style.getPropertyValue('--egy-chat-viewport-height') !== value) {
      document.documentElement.style.setProperty('--egy-chat-viewport-height', value);
    }
  };
  const scheduleSync = () => {
    if (syncFrame) return;
    syncFrame = window.requestAnimationFrame(syncChatViewport);
  };

  window.addEventListener('resize', scheduleSync, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleSync, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleSync, { passive: true });
  }
  const observer = new MutationObserver(scheduleSync);
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('focusin', event => {
    if (event.target?.id !== 'messagesComposerInput') return;
    scheduleSync();
    window.setTimeout(() => {
      if (event.target?.isConnected) event.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 80);
  });
  syncChatViewport();
})();
