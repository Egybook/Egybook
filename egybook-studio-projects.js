/* EgyBook Studio — local project persistence (IndexedDB only; media stays on device). */
(() => {
  'use strict';
  if (window.EgyBookStudioProjects) return;
  const DB_NAME = 'egybook-studio-projects';
  const STORE = 'projects';
  let dbPromise;

  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('INDEXED_DB_UNAVAILABLE'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('PROJECT_DB_OPEN_FAILED'));
      request.onblocked = () => reject(new Error('PROJECT_DB_BLOCKED'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }

  async function put(project) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(project);
      tx.oncomplete = () => resolve(project);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('PROJECT_SAVE_FAILED'));
    });
  }
  async function all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
      request.onerror = () => reject(request.error || new Error('PROJECT_LIST_FAILED'));
    });
  }
  async function get(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(String(id));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('PROJECT_READ_FAILED'));
    });
  }
  async function remove(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(String(id));
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('PROJECT_DELETE_FAILED'));
    });
  }
  window.EgyBookStudioProjects = { put, all, get, remove };
})();
