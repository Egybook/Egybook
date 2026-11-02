/* EgyBook Storage Manager v159
 * Cross-platform best-effort storage support for Chrome, installed PWA,
 * iOS Safari/Home Screen web apps, and Android WebView.
 * Never stores authentication, messages, Supabase responses, or private media.
 */
(() => {
  'use strict';
  if (window.EgyBookStorage) return;
  const DB_NAME = 'egybook-local-cache-v1';
  const DB_VERSION = 1;
  const STORE = 'public-content';
  const MAX_RECORDS = 120;
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  let dbPromise;

  const openDB = () => {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'key' });
            store.createIndex('savedAt', 'savedAt');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  };

  const safeKey = value => {
    const key = String(value || '');
    if (!key || key.length > 500 || /(?:supabase|auth|token|message|private|signed|session)/i.test(key)) return null;
    try {
      const url = new URL(key, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/Egybook/')) return null;
      if (/\.(?:mp4|webm|mov|mp3|m4a|aac|wav|ogg)$/i.test(url.pathname)) return null;
      return url.href;
    } catch (_) { return null; }
  };

  async function get(key) {
    const safe = safeKey(key); if (!safe) return null;
    const db = await openDB(); if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(safe);
        req.onsuccess = () => {
          const item = req.result;
          if (!item || Date.now() - item.savedAt > MAX_AGE) { if (item) remove(safe); resolve(null); }
          else resolve(item.value);
        };
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function put(key, value) {
    const safe = safeKey(key);
    if (!safe || typeof value !== 'string' || value.length > 150000) return false;
    const db = await openDB(); if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key: safe, value, savedAt: Date.now() });
        tx.oncomplete = async () => { await prune(db); resolve(true); };
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function remove(key) {
    const safe = safeKey(key); if (!safe) return false;
    const db = await openDB(); if (!db) return false;
    return new Promise(resolve => {
      try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(safe); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); }
      catch (_) { resolve(false); }
    });
  }

  async function prune(db) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE); const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || []; const cutoff = Date.now() - MAX_AGE;
        rows.sort((a,b) => b.savedAt - a.savedAt);
        rows.forEach((row, index) => { if (row.savedAt < cutoff || index >= MAX_RECORDS) store.delete(row.key); });
      };
    } catch (_) {}
  }

  async function estimate() {
    try { if (navigator.storage?.estimate) return await navigator.storage.estimate(); } catch (_) {}
    return null;
  }

  async function requestPersistence() {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch (_) {}
    return false;
  }

  async function maintain() {
    const db = await openDB(); if (db) await prune(db);
    const info = await estimate();
    if (info && info.quota && info.usage / info.quota > 0.85 && 'serviceWorker' in navigator) {
      const controller = navigator.serviceWorker.controller;
      controller?.postMessage({ type: 'EGB_STORAGE_MAINTENANCE' });
    }
    return info;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showIOSInstallHelp() {
    if (!isIOS() || isStandalone() || sessionStorage.getItem('egybook_ios_install_dismissed') === '1') return;
    const show = () => {
      if (!document.body || document.getElementById('egybook-ios-install-help')) return;
      const card = document.createElement('aside');
      card.id = 'egybook-ios-install-help';
      card.dir = 'rtl';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'تثبيت EgyBook على الآيفون');
      Object.assign(card.style, {
        position: 'fixed', insetInline: '12px', bottom: 'calc(76px + env(safe-area-inset-bottom))', zIndex: '2147482500',
        padding: '14px 16px', borderRadius: '18px', color: '#fff', background: 'linear-gradient(135deg,#101d3c,#173b70)',
        boxShadow: '0 10px 35px rgba(0,0,0,.28)', font: '14px/1.65 system-ui,sans-serif', border: '1px solid rgba(90,190,255,.35)'
      });
      card.innerHTML = '<button type="button" aria-label="إغلاق" style="float:left;border:0;background:transparent;color:#fff;font-size:22px;padding:0 4px">×</button><strong style="display:block;font-size:15px;margin-bottom:4px">ثبّت EgyBook على الآيفون</strong><div>من Safari اضغط زر المشاركة <b>مشاركة</b>، ثم اختر <b>إضافة إلى الشاشة الرئيسية</b>، وبعدها اضغط <b>إضافة</b>.</div>';
      card.querySelector('button').addEventListener('click', () => { try { sessionStorage.setItem('egybook_ios_install_dismissed','1'); } catch (_) {} card.remove(); });
      document.body.appendChild(card);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true }); else show();
  }

  window.EgyBookStorage = Object.freeze({ get, put, remove, estimate, maintain, requestPersistence, isIOS, isStandalone });
  maintain();
  showIOSInstallHelp();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maintain(); }, { passive: true });
})();
