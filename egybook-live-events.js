/* EgyBook Live Events Engine v3
 * A single account-scoped owner for unread counts and durable notification events.
 * All social sources publish to public.notifications; no client-side table-wide
 * reaction/comment subscriptions are needed for notification delivery.
 */
(() => {
  'use strict';
  if (window.__egybookLiveEventsModuleLoaded) return;
  window.__egybookLiveEventsModuleLoaded = true;

  const PREFIX = 'egybook_live_badges_v3::';
  const LEGACY_PREFIX = 'egybook_live_badges_v2::';
  const seen = new Map();
  let activeUserId = null;
  let messageUnread = 0;
  let messageSnapshotReady = false;
  let notificationSnapshotReady = false;
  let reconcileTimer = null;
  let lastReconcileAt = 0;
  let reconcileInFlight = false;
  let reconcilePending = false;
  let reconcileRetryTimer = null;
  let notificationRetryBackoff = 0;
  let recentRecoveryInFlight = false;
  let lastRecentRecoveryAt = 0;

  const key = (kind, userId = activeUserId) => `${PREFIX}${userId || 'guest'}::${kind}`;
  const safeCount = value => Math.max(0, Math.floor(Number(value) || 0));
  const saveCount = (kind, count) => {
    const value = safeCount(count);
    try { localStorage.setItem(key(kind), String(value)); } catch (_) {}
    return value;
  };
  const readCount = kind => {
    try {
      const current = localStorage.getItem(key(kind));
      if (current !== null) return safeCount(current);
      const legacy = localStorage.getItem(`${LEGACY_PREFIX}${activeUserId || 'guest'}::${kind}`);
      if (legacy !== null) return saveCount(kind, legacy);
      return 0;
    } catch (_) { return 0; }
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
    // Notifications are never restored from localStorage. The only displayed
    // value is a fresh COUNT from the durable notifications table (or a live
    // event followed by an authoritative reconciliation).
    display('.notification-badge, .header-notification-badge, .sidebar-alert', count, 9);
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
    // Message count keeps its previous fallback; notification count must be
    // authoritative and is intentionally hidden until the first DB snapshot.
    paintNotificationBadge(0);
    paintMessageBadge(readCount('messages'));
  }
  function semanticIdentity(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    if (row.id && (kind === 'notification' || kind === 'notifications')) return `notification:${row.id}`;
    const actor = String(row.actor_id || row.user_id || row.sender_id || '');
    const type = String(row.type || kind || 'notification');
    const friendId = row.friend_request_id || (type === 'friend_request' || kind === 'friend_request' ? row.id : null);
    if (friendId) return `friend:${friendId}`;
    const commentId = row.comment_id || (type.includes('comment') || kind === 'comment' ? row.id : null);
    if (commentId) return `comment:${commentId}:${actor}`;
    if (row.post_id && actor && /reaction|like/i.test(`${type}:${kind}`))
      return `reaction:${row.post_id}:${actor}:${row.id || ''}`;
    return `notification:${row.id || `${type}:${row.target_id || row.post_id || ''}:${actor}:${row.created_at || ''}`}`;
  }
  function normalizeNotification(kind, payload) {
    const row = payload?.new || payload?.old || payload || {};
    const rawType = String(row.type || kind || 'notification').toLowerCase();
    let type = 'system';
    if (rawType === 'friend_request' || rawType === 'friend' || rawType === 'follow') type = 'friend';
    else if (rawType === 'comment_reply' || rawType === 'reel_reply') type = 'reply';
    else if (rawType.includes('reaction') || rawType === 'reel_like') type = 'reaction';
    else if (rawType.includes('comment')) type = 'comment';
    else if (rawType === 'system') type = 'system';
    const fallbackText = type === 'friend' ? 'أرسل لك طلب صداقة'
      : type === 'reaction' ? 'تفاعل مع محتواك'
      : type === 'reply' ? 'رد على تعليقك'
      : type === 'comment' ? 'علّق على محتواك' : 'لديك إشعار جديد';
    return {
      id: `db:${row.id || semanticIdentity(kind, payload)}`,
      dbId: row.id || null,
      type,
      rawType,
      actorId: row.actor_id || row.user_id || row.sender_id || null,
      postId: row.post_id ? String(row.post_id) : null,
      commentId: row.comment_id ? String(row.comment_id) : null,
      requestId: row.friend_request_id || null,
      targetType: row.target_type || (row.post_id ? 'post' : null),
      targetId: row.target_id ? String(row.target_id) : (row.post_id ? String(row.post_id) : null),
      source: row.source || 'supabase',
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      name: row.actor_name || row.user_name || 'عضو EgyBook',
      avatar: row.avatar_url || '',
      text: row.body || row.title || fallbackText,
      created_at: row.created_at || new Date().toISOString()
    };
  }
  function pruneSeen(now) {
    for (const [id, timestamp] of seen) if (now - timestamp > 300000) seen.delete(id);
  }
  async function announceDurableNotification(notification) {
    const bridge = window.__egybookLiveEventsBridge;
    if (!notification || typeof bridge?.announce !== 'function') return;
    // Reserve the durable id synchronously so the notification-center recovery
    // path cannot race the popup path and show the same notification twice.
    const reserved = bridge.reserveNotificationAnnouncement?.(notification);
    if (reserved === false) return;
    // Resolve the actor's display name once per live event. The durable row is
    // already committed; this small profile lookup affects the popup only.
    if (notification.actorId && bridge.getClient) {
      try {
        const client = bridge.getClient();
        const { data, error } = await client.from('profiles')
          .select('id,full_name,username,avatar_url')
          .eq('id', notification.actorId).maybeSingle();
        if (!error && data) {
          notification.name = data.full_name || data.username || notification.name;
          notification.username = data.username || '';
          notification.avatar = data.avatar_url || '';
        }
      } catch (_) {}
    }
    // Do not display a notification from a stale account/session.
    if (String(bridge.getUser?.()?.id || '') !== activeUserId) {
      bridge.releaseNotificationAnnouncement?.(notification);
      seen.delete(`notification:${notification.dbId}`);
      return;
    }
    const delivered = bridge.announce(notification);
    if (delivered === false && notification.dbId) seen.delete(`notification:${notification.dbId}`);
  }
  function handleNotificationEvent(event) {
    const detail = event.detail || {};
    if (!activeUserId || String(detail.userId || '') !== activeUserId) return;
    const identity = semanticIdentity(detail.kind, detail.payload);
    const now = Date.now(); pruneSeen(now);
    if (seen.has(identity)) return;
    seen.set(identity, now);
    // Reconcile from the durable table instead of incrementing a cached count.
    scheduleReconcile(true);
    void announceDurableNotification(normalizeNotification(detail.kind, detail.payload));
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
    scheduleReconcile(true);
  }
  function isMissingNotificationsSchema(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42P01' || code === '42703' || code === 'PGRST205' ||
      /relation .*notifications.* does not exist|column .* does not exist|could not find the table .*notifications|schema cache.*notifications/.test(message);
  }
  function scheduleTransientRetry() {
    notificationRetryBackoff = Math.min(notificationRetryBackoff + 1, 5);
    const delays = [2000, 5000, 10000, 20000, 30000];
    clearTimeout(reconcileRetryTimer);
    reconcileRetryTimer = setTimeout(() => {
      reconcileRetryTimer = null;
      scheduleReconcile(true);
    }, delays[notificationRetryBackoff - 1]);
  }
  async function reconcileSnapshots() {
    if (reconcileInFlight) { reconcilePending = true; return; }
    if (!activeUserId || document.visibilityState === 'hidden') return;
    const bridge = window.__egybookLiveEventsBridge;
    const client = bridge?.getClient?.();
    const user = bridge?.getUser?.();
    const requestedUserId = activeUserId;
    if (!client || !user?.id || String(user.id) !== requestedUserId) return;
    reconcileInFlight = true;
    try {
      const jobs = [
        client.from('direct_messages').select('id', { count: 'exact', head: true })
          .eq('recipient_id', requestedUserId).is('read_at', null),
        client.from('notifications').select('id', { count: 'exact', head: true })
          .eq('recipient_id', requestedUserId).is('read_at', null)
      ];
      const results = await Promise.allSettled(jobs);
      // Never paint a previous account's delayed response into the new session.
      if (activeUserId !== requestedUserId || String(bridge.getUser?.()?.id || '') !== requestedUserId) return;
      const messages = results[0];
      if (messages.status === 'fulfilled' && !messages.value.error && Number.isFinite(messages.value.count)) {
        messageSnapshotReady = true;
        paintMessageBadge(messages.value.count);
        window.dispatchEvent(new CustomEvent('egybook:message-badge-snapshot', { detail: { userId: activeUserId, count: messages.value.count } }));
      }
      const notifications = results[1];
      if (notifications.status === 'fulfilled' && !notifications.value.error && Number.isFinite(notifications.value.count)) {
        notificationSnapshotReady = true;
        notificationRetryBackoff = 0;
        clearTimeout(reconcileRetryTimer); reconcileRetryTimer = null;
        paintNotificationBadge(notifications.value.count);
        window.dispatchEvent(new CustomEvent('egybook:notification-badge-snapshot', { detail: { userId: activeUserId, count: notifications.value.count } }));
      } else if (notifications.status === 'fulfilled' && notifications.value.error) {
        if (isMissingNotificationsSchema(notifications.value.error)) {
          // This is a setup/schema problem, not a reason to retry on every focus.
          notificationSnapshotReady = false;
          paintNotificationBadge(0);
          console.warn('EgyBook notifications table needs the V217 Supabase migration.');
        } else {
          console.warn('EgyBook notification count snapshot failed:', notifications.value.error.message);
          scheduleTransientRetry();
        }
      } else if (notifications.status === 'rejected') {
        console.warn('EgyBook notification count snapshot was rejected:', notifications.reason?.message || notifications.reason);
        scheduleTransientRetry();
      }
    } catch (error) {
      console.warn('EgyBook notification reconciliation failed:', error);
      scheduleTransientRetry();
    } finally {
      reconcileInFlight = false;
      if (reconcilePending) {
        reconcilePending = false;
        scheduleReconcile(true);
      }
    }
  }
  function scheduleReconcile(force = false) {
    if (document.visibilityState === 'hidden' || !activeUserId) return;
    clearTimeout(reconcileTimer);
    const minimumGap = force ? 1000 : 8000;
    const wait = Math.max(force ? 350 : 450, minimumGap - (Date.now() - lastReconcileAt));
    reconcileTimer = setTimeout(() => {
      lastReconcileAt = Date.now();
      void reconcileSnapshots();
    }, wait);
  }

  async function recoverRecentNotifications() {
    const now = Date.now();
    if (!activeUserId || document.visibilityState === 'hidden' || recentRecoveryInFlight || now - lastRecentRecoveryAt < 20000) return;
    const bridge = window.__egybookLiveEventsBridge;
    const client = bridge?.getClient?.();
    const requestedUserId = activeUserId;
    if (!client || String(bridge?.getUser?.()?.id || '') !== requestedUserId) return;
    recentRecoveryInFlight = true;
    lastRecentRecoveryAt = now;
    try {
      const since = new Date(now - 90000).toISOString();
      let result = await client.from('notifications')
        .select('id,type,title,body,actor_id,post_id,comment_id,friend_request_id,created_at,read_at,source,target_type,target_id,metadata')
        .eq('recipient_id', requestedUserId).is('read_at', null)
        .gte('created_at', since).order('created_at', { ascending: false }).limit(12);
      if (result.error && /column|schema cache|source|target_type|target_id|metadata/i.test(String(result.error.message || ''))) {
        result = await client.from('notifications')
          .select('id,type,title,body,actor_id,post_id,comment_id,friend_request_id,created_at,read_at')
          .eq('recipient_id', requestedUserId).is('read_at', null)
          .gte('created_at', since).order('created_at', { ascending: false }).limit(12);
      }
      if (activeUserId !== requestedUserId || String(bridge.getUser?.()?.id || '') !== requestedUserId) return;
      if (result.error || !Array.isArray(result.data) || !result.data.length) return;
      const rows = result.data.filter(row => {
        const identity = `notification:${row.id}`;
        if (!row.id || seen.has(identity)) return false;
        const item = { dbId: row.id, id: `db:${row.id}` };
        if (bridge.isNotificationAnnounced?.(item)) { seen.set(identity, Date.now()); return false; }
        return true;
      });
      if (!rows.length) return;
      // Catch up only the newest event. The center still contains the full recent
      // set; this avoids stacking several popups after a tab wakes from suspension.
      const row = rows.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0];
      const notification = normalizeNotification('notification', { new: row });
      const reserved = bridge.reserveNotificationAnnouncement?.(notification);
      if (reserved === false) { seen.set(`notification:${row.id}`, Date.now()); return; }
      const actorProfile = row.actor_id ? await client.from('profiles')
        .select('id,full_name,username,avatar_url').eq('id', row.actor_id).maybeSingle() : null;
      if (activeUserId !== requestedUserId || String(bridge.getUser?.()?.id || '') !== requestedUserId) return;
      if (!actorProfile?.error && actorProfile?.data) {
        notification.name = actorProfile.data.full_name || actorProfile.data.username || notification.name;
        notification.username = actorProfile.data.username || '';
        notification.avatar = actorProfile.data.avatar_url || '';
      }
      const identity = `notification:${row.id}`;
      if (String(bridge.getUser?.()?.id || '') === requestedUserId && activeUserId === requestedUserId) {
        const delivered = bridge.announce?.(notification);
        if (delivered === false) { seen.delete(identity); return; }
        seen.set(identity, Date.now());
      } else {
        bridge.releaseNotificationAnnouncement?.(notification);
      }
    } catch (error) {
      console.warn('EgyBook recent notification recovery failed:', error?.message || error);
    } finally {
      recentRecoveryInFlight = false;
    }
  }

  window.__egybookLiveEventsState = {
    hasMessageSnapshot: () => messageSnapshotReady,
    hasNotificationSnapshot: () => notificationSnapshotReady,
    getMessageCount: () => messageUnread,
    reconcile: () => scheduleReconcile(true)
  };
  window.addEventListener('egybook:live-session', event => {
    const nextId = String(event.detail?.userId || '');
    activeUserId = nextId || null;
    seen.clear();
    clearTimeout(reconcileTimer);
    clearTimeout(reconcileRetryTimer);
    reconcileTimer = null;
    reconcileRetryTimer = null;
    reconcilePending = false;
    notificationRetryBackoff = 0;
    lastRecentRecoveryAt = 0;
    messageSnapshotReady = false;
    notificationSnapshotReady = false;
    lastReconcileAt = 0;
    if (!activeUserId) {
      messageUnread = 0;
      paintNotificationBadge(0);
      paintMessageBadge(0);
      return;
    }
    restoreCachedBadges();
    scheduleReconcile(true);
  });
  // No listener for the legacy client-computed notification badge event:
  // that count was derived from a truncated list and could overwrite COUNT(*).
  window.addEventListener('egybook:notification-event', handleNotificationEvent);
  window.addEventListener('egybook:incoming-message', handleIncomingMessage);
  window.addEventListener('egybook:notifications-read', () => scheduleReconcile(true));
  window.addEventListener('egybook:notification-state-change', () => scheduleReconcile(true));
  window.addEventListener('egybook:realtime-restored', () => { scheduleReconcile(true); void recoverRecentNotifications(); });
  window.addEventListener('egybook:messages-read', () => scheduleReconcile(true));
  window.addEventListener('online', () => scheduleReconcile(true), { passive: true });
  window.addEventListener('focus', () => scheduleReconcile(), { passive: true });
  window.addEventListener('pageshow', () => scheduleReconcile(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { scheduleReconcile(true); void recoverRecentNotifications(); }
  }, { passive: true });

  const existingUser = window.__egybookLiveEventsBridge?.getUser?.();
  if (existingUser?.id) {
    activeUserId = String(existingUser.id);
    restoreCachedBadges();
    scheduleReconcile(true);
  }
})();
