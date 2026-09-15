(function (global) {
  'use strict';
  const listeners = {};
  const state = {
    ownId: null,
    activeConv: null,
    seenMsgs: new Set(),
    lastSeenTs: new Map(),
    statuses: new Map(),
    seenOnline: new Map(),
    seenTyping: new Map(),
    lastOtherOf: new Map(),
    iter: 0
  };

  function on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return this; }

  function dispatch(ev, data) { (listeners[ev] || []).forEach((cb) => { try { cb(data); } catch (e) { /* noop */ } }); }

  async function api(path, options) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      method: (options && options.method) || 'GET',
      headers: (options && options.body) ? { 'Content-Type': 'application/json' } : undefined,
      body: (options && options.body) ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function emit(ev, data) {
    if (ev === 'join') { state.activeConv = data; }
    else if (ev === 'message') {
      if (!state.activeConv && data && data.conversationId) state.activeConv = data.conversationId;
      api('/api/messages', { method: 'POST', body: data })
        .then((r) => {
          const m = r.message;
          state.seenMsgs.add(m.id);
          if (m.createdAt) state.lastSeenTs.set(m.conversationId, m.createdAt);
          dispatch('message', m);
        })
        .catch(() => { /* surfaced via polls */ });
    } else if (ev === 'typing') { api('/api/typing', { method: 'POST', body: data }).catch(() => {}); }
    else if (ev === 'read') { api('/api/messages/' + data.conversationId + '/read', { method: 'POST', body: {} }).catch(() => {}); }
  }

  async function pollMessages() {
    const conv = state.activeConv;
    if (!conv) return;
    state.iter = (state.iter + 1) % 12;
    const isFull = state.iter === 0;
    const knownTs = state.lastSeenTs.has(conv) ? state.lastSeenTs.get(conv) : null;
    const since = isFull ? null : knownTs;
    const q = since ? '?laterThan=' + encodeURIComponent(since) : '';
    const d = await api('/api/messages/' + conv + q);
    const otherId = (d.members && state.ownId) ? (d.members[0] === state.ownId ? d.members[1] : d.members[0]) : null;
    let lastCreated = null;
    for (const m of d.messages) {
      const isNew = !state.seenMsgs.has(m.id);
      state.seenMsgs.add(m.id);
      if (m.createdAt) { lastCreated = m.createdAt; }
      if (isNew && (since || isFull)) dispatch('message', m);
      if (m.senderId === state.ownId && otherId) {
        const prev = state.statuses.get(m.id);
        if (prev && prev !== m.status) {
          if (m.status === 'read') dispatch('read', { conversationId: m.conversationId, userId: otherId });
          else if (m.status === 'delivered') dispatch('delivered', { conversationId: m.conversationId, messageId: m.id });
        }
        state.statuses.set(m.id, m.status);
      }
    }
    if (lastCreated) {
      const prevTs = state.lastSeenTs.get(conv);
      if (!prevTs || prevTs < lastCreated) state.lastSeenTs.set(conv, lastCreated);
    }
  }

  async function pollConversations() {
    const d = await api('/api/conversations');
    for (const c of d.conversations) {
      const other = c.other;
      state.lastOtherOf.set(c.id, other.id);
      const online = !!other.online;
      if (state.seenOnline.has(other.id) && state.seenOnline.get(other.id) !== online) dispatch('presence', { userId: other.id, online });
      state.seenOnline.set(other.id, online);

      const t = c.typing;
      let key = null;
      if (t && t.user) key = t.user.id + '@' + (t.user.isTyping ? '1' : '0');
      const prev = state.seenTyping.get(c.id);
      state.seenTyping.set(c.id, key);
      if (prev !== key && c.id === state.activeConv) {
        dispatch('typing', { user: t ? t.user : { id: other.id }, isTyping: !!(t && t.user) });
      }

      if (!state.activeConv || c.id !== state.activeConv) {
        if (c.lastMessage && !state.seenMsgs.has(c.lastMessage.id)) {
          state.seenMsgs.add(c.lastMessage.id);
          dispatch('message', { ...c.lastMessage, conversationId: c.id });
        }
      }
    }
  }

  async function pollTyping() {
    const conv = state.activeConv;
    if (!conv) return;
    const d = await api('/api/typing/' + conv, { cache: 'no-store' }).catch(() => null);
    if (!d) return;
    const tk = d.isTyping ? (d.user ? d.user.id + '@1' : '?@1') : null;
    const prev = state.seenTyping.get(conv);
    if (prev !== tk) {
      state.seenTyping.set(conv, tk);
      dispatch('typing', { user: d.user || { id: state.lastOtherOf.get(conv) || '' }, isTyping: d.isTyping });
    }
  }

  let running = false;
  async function loop() {
    if (running) return;
    running = true;
    try {
      await Promise.all([pollConversations(), pollMessages()]);
    } catch (e) { /* transient */ }
    running = false;
    setTimeout(loop, 3000);
  }

  function createRealtime() {
    api('/api/me').then((d) => { state.ownId = d.user ? d.user.id : null; }).catch(() => {});
    setInterval(() => api('/api/presence', { method: 'POST', body: {} }).catch(() => {}), 60000);
    setInterval(pollTyping, 700);
    loop();
    return { on, emit };
  }

  global.io = createRealtime;
})(window);