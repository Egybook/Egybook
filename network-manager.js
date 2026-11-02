/* EgyBook Network Manager v158
 * Shows connection state only. It never retries writes or changes app requests.
 */
(() => {
  'use strict';
  if (window.EgyBookNetwork) return;
  let banner;
  let onlineTimer;
  const ensureBanner = () => {
    if (banner || !document.body) return banner;
    banner = document.createElement('div');
    banner.id = 'egybook-network-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    Object.assign(banner.style, {
      position: 'fixed', top: 'max(8px, env(safe-area-inset-top))', left: '50%',
      transform: 'translate(-50%, -12px)', zIndex: '2147483000', maxWidth: 'calc(100vw - 24px)',
      padding: '9px 16px', borderRadius: '999px', color: '#fff', background: '#b42318',
      boxShadow: '0 4px 18px rgba(0,0,0,.18)', font: '600 13px/1.4 system-ui,sans-serif',
      textAlign: 'center', opacity: '0', pointerEvents: 'none', transition: 'opacity .2s ease, transform .2s ease'
    });
    document.body.appendChild(banner);
    return banner;
  };
  const show = (message, online) => {
    const el = ensureBanner(); if (!el) return;
    el.textContent = message;
    el.style.background = online ? '#16834a' : '#b42318';
    el.style.opacity = '1'; el.style.transform = 'translate(-50%, 0)';
    clearTimeout(onlineTimer);
    if (online) onlineTimer = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%, -12px)'; }, 2600);
  };
  const wentOffline = () => show('الاتصال بالإنترنت انقطع — بعض الخدمات قد لا تعمل', false);
  const cameOnline = () => show('عاد الاتصال بالإنترنت', true);
  const init = () => {
    if (!navigator.onLine) wentOffline();
    window.addEventListener('offline', wentOffline, { passive: true });
    window.addEventListener('online', cameOnline, { passive: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  window.EgyBookNetwork = Object.freeze({ isOnline: () => navigator.onLine });
})();
