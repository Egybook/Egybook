/* EgyBook Live Events Engine
 * Account-scoped badge persistence and lightweight message reconciliation.
 * Social event subscriptions remain owned by the existing central Realtime channel.
 */
(() => {
  'use strict';
  if (window.__egybookLiveEventsModuleLoaded) return;
  window.__egybookLiveEventsModuleLoaded = true;

  const PREFIX = 'egybook_live_badges_v1::';
  const seen = new Map();
  let activeUserId = null;
  let messageUnread = null;
  let reconcileTimer = null;
  let lastReconcileAt = 0;

  const key = (kind, userId = activeUserId) => `${PREFIX}${userId || 'guest'}::${kind}`;
  const readCount = kind => {
    try { return Math.max(0, Number(localStorage.getItem(key(kind))) || 0); }
    catch (_) { return 0; }
  };
  const saveCount = (kind, count) => {
    const safe = Math.max(0, Math.floor(Number(count) || 0));
    try { localStorage.setItem(key(kind), String(safe)); } catch (_) {}
    return safe;
  };
  const display = (selector, count, max = 99) => {
    const value = Math.max(0, Math.floor(Number(count) || 0));
    document.querySelectorAll(selector).forEach(node => {
      node.hidden = value <= 0;
      node.textContent = value > max ? `${max}+` : String(value);
      node.setAttribute('aria-hidden', value <= 0 ? 'true' : 'false');
    });
  };
  function paintNotificationBadge(count) {
    const value = saveCount('notifications', count);
    display('.notification-badge, .header-notification-badge, .sidebar-alert', value, 9);
  }
  function paintMessageBadge(count) {
    messageUnread = saveCount('messages', count);
    display('[data-message-badge]', messageUnread, 99);
    const tab = document.querySelector('#messagesUnreadCount');
    if (tab) {
      tab.hidden = messageUnread <= 0;
      tab.textContent = messageUnread > 99 ? '99+' : String(messageUnread);
    }
  }
  function restoreCachedBadges(userId) {
    paintNotificationBadge(readCount('notifications', userId));
    paintMessageBadge(readCount('messages', userId));
  }
  function eventIdentity(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    const actor = row.actor_id || row.user_id || row.sender_id || '';
    if (kind === 'friend_request' || row.friend_request_id)
      return `friend:${row.friend_request_id || row.id || ''}`;
    if (kind === 'reaction' || row.type === 'reaction')
      return `reaction:${row.post_id || ''}:${actor}`;
    if (kind === 'comment' || row.comment_id || row.type === 'comment' || row.type === 'comment_reply')
      return `comment:${row.comment_id || row.id || ''}`;
    return `notification:${row.id || `${row.type || kind}:${row.post_id || ''}:${actor}`}`;
  }
  function normalizeNotification(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    const type = row.type === 'friend_request' || kind === 'friend_request' ? 'friend'
      : row.type === 'comment_reply' ? 'reply'
      : row.type === 'reaction' || kind === 'reaction' ? 'reaction'
      : row.type === 'comment' || kind === 'comment' ? 'comment' : 'notification';
    const text = row.body || row.title ||
      (type === 'friend' ? 'أرسل لك طلب صداقة' :
       type === 'reaction' ? 'تفاعل مع منشورك' :
       type === 'comment' ? 'علّق على منشورك' : 'لديك إشعار جديد');
    return {
      id: `live:${eventIdentity(kind, payload)}`,
      type,
      actorId: row.actor_id || row.user_id || row.sender_id || null,
      postId: row.post_id ? String(row.post_id) : null,
      commentId: row.comment_id || null,
      requestId: row.friend_request_id || (type === 'friend' ? row.id : null),
      name: row.actor_name || row.user_name || 'عضو EgyBook',
      text,
      created_at: row.created_at || new Date().toISOString()
    };
  }
  function handleNotificationEvent(event) {
    const detail = event.detail || {};
    if (!activeUserId || String(detail.userId || '') !== activeUserId) return;
    const identity = eventIdentity(detail.kind, detail.payload);
    const now = Date.now();
    for (const [id, timestamp] of seen) if (now - timestamp > 120000) seen.delete(id);
    if (seen.has(identity)) return;
    seen.set(identity, now);
    paintNotificationBadge(readCount('notifications') + 1);
    const bridge = window.__egybookLiveEventsBridge;
    if (!document.hidden && typeof bridge?.announce === 'function')
      bridge.announce(normalizeNotification(detail.kind, detail.payload));
  }
  function handleIncomingMessage(event) {
    const detail = event.detail || {};
    if (!activeUserId || String(detail.userId || '') !== activeUserId || detail.threadOpen) return;
    const row = detail.row || {};
    if (row.read_at) return;
    const identity = `message:${row.id || `${row.sender_id}:${row.created_at}`}`;
    const now = Date.now();
    for (const [id, timestamp] of seen) if (now - timestamp > 120000) seen.delete(id);
    if (seen.has(identity)) return;
    seen.set(identity, now);
    paintMessageBadge(readCount('messages') + 1);
  }
  async function reconcileMessages() {
    const bridge = window.__egybookLiveEventsBridge;
    const client = bridge?.getClient?.();
    const user = bridge?.getUser?.();
    if (!client || !user?.id || String(user.id) !== activeUserId) return;
    try {
      const { count, error } = await client.from('direct_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', activeUserId)
        .is('read_at', null);
      if (error) throw error;
      if (Number.isFinite(count)) paintMessageBadge(count);
    } catch (_) {
      // Keep the last known count when the network or optional table is unavailable.
    }
  }
  function scheduleReconcile() {
    if (document.visibilityState === 'hidden' || !activeUserId) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastReconcileAt < 5000) return;
      lastReconcileAt = now;
      void reconcileMessages();
    }, 500);
  }

  window.addEventListener('egybook:live-session', event => {
    const nextId = String(event.detail?.userId || '');
    activeUserId = nextId || null;
    seen.clear();
    if (!activeUserId) {
      messageUnread = 0;
      display('.notification-badge, .header-notification-badge, .sidebar-alert', 0, 9);
      display('[data-message-badge]', 0, 99);
      return;
    }
    restoreCachedBadges(activeUserId);
    scheduleReconcile();
  });
  window.addEventListener('egybook:notification-badge', event => {
    const detail = event.detail || {};
    if (activeUserId && String(detail.userId || '') === activeUserId)
      paintNotificationBadge(detail.count);
  });
  window.addEventListener('egybook:message-badge', event => {
    const detail = event.detail || {};
    if (activeUserId && String(detail.userId || '') === activeUserId)
      paintMessageBadge(detail.count);
  });
  window.addEventListener('egybook:notification-event', handleNotificationEvent);
  window.addEventListener('egybook:incoming-message', handleIncomingMessage);
  window.addEventListener('egybook:realtime-restored', scheduleReconcile);
  window.addEventListener('online', scheduleReconcile, { passive: true });
  window.addEventListener('focus', scheduleReconcile, { passive: true });
  window.addEventListener('pageshow', scheduleReconcile, { passive: true });
  document.addEventListener('visibilitychange', scheduleReconcile, { passive: true });

  // In case this module is loaded after the initial auth snapshot event.
  const existingUser = window.__egybookLiveEventsBridge?.getUser?.();
  if (existingUser?.id) {
    activeUserId = String(existingUser.id);
    restoreCachedBadges(activeUserId);
    scheduleReconcile();
  }
})();
