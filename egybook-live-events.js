/* EgyBook Live Events Engine v2
 * One owner for account-scoped live badge state, deduplication and snapshots.
 * Reuses the app's existing central Supabase Realtime channel; creates no channel.
 */
(() => {
  'use strict';
  if (window.__egybookLiveEventsModuleLoaded) return;
  window.__egybookLiveEventsModuleLoaded = true;

  const PREFIX = 'egybook_live_badges_v2::';
  const LEGACY_PREFIX = 'egybook_live_badges_v1::';
  const seen = new Map();
  let activeUserId = null;
  let messageUnread = 0;
  let messageSnapshotReady = false;
  let notificationSnapshotReady = false;
  let reconcileTimer = null;
  let lastReconcileAt = 0;
  let unsupportedNotificationsTable = false;
  let reconcileInFlight = false;

  const key = (kind, userId = activeUserId) => `${PREFIX}${userId || 'guest'}::${kind}`;
  const safeCount = value => Math.max(0, Math.floor(Number(value) || 0));
  const readCount = kind => {
    try {
      const current = localStorage.getItem(key(kind));
      if (current !== null) return safeCount(current);
      const legacy = localStorage.getItem(`${LEGACY_PREFIX}${activeUserId || 'guest'}::${kind}`);
      if (legacy !== null) return saveCount(kind, legacy);
      return 0;
    } catch (_) { return 0; }
  };
  const saveCount = (kind, count) => {
    const value = safeCount(count);
    try { localStorage.setItem(key(kind), String(value)); } catch (_) {}
    return value;
  };
  const display = (selector, count, max = 99) => {
    const value = safeCount(count);
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
  function restoreCachedBadges() {
    paintNotificationBadge(readCount('notifications'));
    paintMessageBadge(readCount('messages'));
  }
  function semanticIdentity(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    const actor = String(row.actor_id || row.user_id || row.sender_id || '');
    const type = String(row.type || kind || 'notification');
    const friendId = row.friend_request_id || (type === 'friend_request' || kind === 'friend_request' ? row.id : null);
    if (friendId) return `friend:${friendId}`;
    const commentId = row.comment_id || (type.includes('comment') || kind === 'comment' ? row.id : null);
    if (commentId) return `comment:${commentId}`;
    if (row.post_id && actor && /reaction|like/i.test(`${type}:${kind}`))
      return `reaction:${row.post_id}:${actor}`;
    if (row.post_id && actor && /comment|reply/i.test(`${type}:${kind}`))
      return `comment-post:${row.post_id}:${actor}:${String(row.body || '').slice(0,48)}`;
    return `notification:${row.id || `${type}:${row.post_id || ''}:${actor}:${row.created_at || ''}`}`;
  }
  function normalizeNotification(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    const rawType = String(row.type || kind || 'notification');
    const type = rawType === 'friend_request' || kind === 'friend_request' ? 'friend'
      : rawType === 'comment_reply' ? 'reply'
      : rawType === 'reaction' || kind === 'reaction' ? 'reaction'
      : rawType === 'comment' || kind === 'comment' ? 'comment' : 'notification';
    const text = row.body || row.title ||
      (type === 'friend' ? 'أرسل لك طلب صداقة' :
       type === 'reaction' ? 'تفاعل مع منشورك' :
       type === 'comment' ? 'علّق على منشورك' :
       type === 'reply' ? 'رد على تعليقك' : 'لديك إشعار جديد');
    return {
      id: `live:${semanticIdentity(kind, payload)}`,
      dbId: kind === 'notification' && row.id ? row.id : null,
      type,
      actorId: row.actor_id || row.user_id || row.sender_id || null,
      postId: row.post_id ? String(row.post_id) : null,
      commentId: row.comment_id || (type === 'comment' || type === 'reply' ? row.id : null),
      requestId: row.friend_request_id || (type === 'friend' ? row.id : null),
      name: row.actor_name || row.user_name || row.title || 'عضو EgyBook',
      text,
      created_at: row.created_at || new Date().toISOString()
    };
  }
  function pruneSeen(now) {
    for (const [id, timestamp] of seen) if (now - timestamp > 180000) seen.delete(id);
  }
  function handleNotificationEvent(event) {
    const detail = event.detail || {};
    if (!activeUserId || String(detail.userId || '') !== activeUserId) return;
    const identity = semanticIdentity(detail.kind, detail.payload);
    const now = Date.now(); pruneSeen(now);
    if (seen.has(identity)) return;
    seen.set(identity, now);
    // Never increment a stale cached number before the account snapshot is
    // authoritative. This was the source of badge inflation after reloads.
    if (notificationSnapshotReady) {
      paintNotificationBadge(readCount('notifications') + 1);
    } else {
      scheduleReconcile();
    }
    // Always announce the event, independently from badge reconciliation.
    const bridge = window.__egybookLiveEventsBridge;
    if (typeof bridge?.announce === 'function') bridge.announce(normalizeNotification(detail.kind, detail.payload));
  }
  function handleIncomingMessage(event) {
    const detail = event.detail || {};
    if (!activeUserId || String(detail.userId || '') !== activeUserId) return;
    const row = detail.row || {};
    if (detail.threadOpen || row.read_at) return;
    const identity = `message:${row.id || `${row.sender_id}:${row.created_at}`}`;
    const now = Date.now(); pruneSeen(now);
    if (seen.has(identity)) return;
    seen.set(identity, now);
    paintMessageBadge(messageUnread + 1);
    window.dispatchEvent(new CustomEvent('egybook:show-message-toast', { detail: { row } }));
  }
  async function reconcileSnapshots() {
    if (reconcileInFlight || !activeUserId || document.visibilityState === 'hidden') return;
    const bridge = window.__egybookLiveEventsBridge;
    const client = bridge?.getClient?.();
    const user = bridge?.getUser?.();
    if (!client || !user?.id || String(user.id) !== activeUserId) return;
    reconcileInFlight = true;
    try {
      const jobs = [
        client.from('direct_messages').select('id', { count: 'exact', head: true })
          .eq('recipient_id', activeUserId).is('read_at', null)
      ];
      if (!unsupportedNotificationsTable) {
        jobs.push(client.from('notifications').select('id', { count: 'exact', head: true })
          .eq('recipient_id', activeUserId).is('read_at', null));
      }
      const results = await Promise.allSettled(jobs);
      const messages = results[0];
      if (messages.status === 'fulfilled' && !messages.value.error && Number.isFinite(messages.value.count)) {
        messageSnapshotReady = true;
        paintMessageBadge(messages.value.count);
        window.dispatchEvent(new CustomEvent('egybook:message-badge-snapshot', { detail: { userId: activeUserId, count: messages.value.count } }));
      }
      if (!unsupportedNotificationsTable && results[1]) {
        const notifications = results[1];
        if (notifications.status === 'fulfilled' && !notifications.value.error && Number.isFinite(notifications.value.count)) {
          notificationSnapshotReady = true;
          paintNotificationBadge(notifications.value.count);
          window.dispatchEvent(new CustomEvent('egybook:notification-badge-snapshot', { detail: { userId: activeUserId, count: notifications.value.count } }));
        } else if (notifications.status === 'fulfilled' && notifications.value.error) {
          // If the durable table is not installed, do not retry it on every focus/reconnect.
          unsupportedNotificationsTable = true;
        }
      }
    } catch (_) {
      // Preserve the last known counts on transient failures.
    } finally {
      reconcileInFlight = false;
    }
  }
  function scheduleReconcile() {
    if (document.visibilityState === 'hidden' || !activeUserId) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastReconcileAt < 8000) return;
      lastReconcileAt = now;
      void reconcileSnapshots();
    }, 450);
  }

  window.__egybookLiveEventsState = {
    hasMessageSnapshot: () => messageSnapshotReady,
    hasNotificationSnapshot: () => notificationSnapshotReady,
    getMessageCount: () => messageUnread
  };
  window.addEventListener('egybook:live-session', event => {
    const nextId = String(event.detail?.userId || '');
    activeUserId = nextId || null;
    seen.clear();
    messageSnapshotReady = false;
    notificationSnapshotReady = false;
    unsupportedNotificationsTable = false;
    if (!activeUserId) {
      messageUnread = 0;
      paintNotificationBadge(0);
      paintMessageBadge(0);
      return;
    }
    restoreCachedBadges();
    scheduleReconcile();
  });
  window.addEventListener('egybook:notification-badge', event => {
    const detail = event.detail || {};
    if (activeUserId && String(detail.userId || '') === activeUserId) {
      notificationSnapshotReady = true;
      paintNotificationBadge(detail.count);
    }
  });
  window.addEventListener('egybook:message-badge', event => {
    const detail = event.detail || {};
    if (activeUserId && String(detail.userId || '') === activeUserId) {
      messageSnapshotReady = true;
      paintMessageBadge(detail.count);
    }
  });
  window.addEventListener('egybook:notification-event', handleNotificationEvent);
  window.addEventListener('egybook:incoming-message', handleIncomingMessage);
  window.addEventListener('egybook:realtime-restored', scheduleReconcile);
  window.addEventListener('egybook:messages-read', scheduleReconcile);
  window.addEventListener('online', scheduleReconcile, { passive: true });
  window.addEventListener('focus', scheduleReconcile, { passive: true });
  window.addEventListener('pageshow', scheduleReconcile, { passive: true });
  document.addEventListener('visibilitychange', scheduleReconcile, { passive: true });

  const existingUser = window.__egybookLiveEventsBridge?.getUser?.();
  if (existingUser?.id) {
    activeUserId = String(existingUser.id);
    restoreCachedBadges();
    scheduleReconcile();
  }
})();
