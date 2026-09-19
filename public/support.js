(function () {
  if (window.NCSupport) return;

  var POLL_MS = 3000;
  var root = null, ticket = null, messages = [], msgIds = new Set(), timer = null, sending = false, lastRenderLen = -1, replyTarget = null;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function linkify(s) { return String(s).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + u + '</a>'; }); }
  function time(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
      return h + ':' + m;
    } catch (e) { return ''; }
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }
  function close() {
    if (root) {
      var c = root.querySelector('.tkt-confirm');
      if (c) { c.remove(); return; }
    }
    if (timer) { clearInterval(timer); timer = null; }
    closeMsgMenu();
    document.removeEventListener('keydown', onKey, true);
    if (root) { root.remove(); root = null; }
    ticket = null; messages = []; msgIds = new Set(); lastRenderLen = -1; replyTarget = null;
  }
  function loadTicket(id) {
    return api('/api/support/tickets/' + encodeURIComponent(id)).then(function (d) {
      ticket = d.ticket;
      messages = (ticket.messages || []).slice();
      msgIds = new Set(messages.map(function (m) { return m.id; }));
      return ticket;
    });
  }
  function renderMessages() {
    var body = root && document.getElementById('tkt-body');
    if (!body) return;
    if (messages.length === lastRenderLen && body.dataset.built) return;
    lastRenderLen = messages.length;
    body.dataset.built = '1';
    if (!messages.length) {
      body.innerHTML = '<div class="tkt-empty">No messages yet. Describe your issue and a support member will reply — you can also talk on our Discord server.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (!m) continue;
      if (m.kind === 'system') {
        html += '<div class="tkt-sys">' + escapeHTML(String(m.content || '')) + '</div>';
      } else if (m.kind === 'staff') {
        html += '<div class="tkt-msg staff" data-mid="' + m.id + '" data-kind="' + m.kind + '" oncontextmenu="return NCSupportMsgMenu(event)"><div class="tkt-bubble"><b>' + escapeHTML(String(m.author || 'Support Team')) + '</b>' + tktReplyHTML(m) + (m.forwarded ? '<span class="tkt-fw">⤴ Forwarded</span>' : '') + '<span>' + linkify(escapeHTML(String(m.content || ''))) + '</span></div><small>' + time(m.createdAt) + (m.edited ? ' · edited' : '') + '</small></div>';
      } else {
        html += '<div class="tkt-msg mine" data-mid="' + m.id + '" data-kind="' + m.kind + '" oncontextmenu="return NCSupportMsgMenu(event)"><div class="tkt-bubble"><b>You</b>' + tktReplyHTML(m) + (m.forwarded ? '<span class="tkt-fw">⤴ Forwarded</span>' : '') + '<span>' + linkify(escapeHTML(String(m.content || ''))) + '</span></div><small>' + time(m.createdAt) + (m.edited ? ' · edited' : '') + '</small></div>';
      }
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }
  function paint(t) {
    if (!root) return;
    var title = document.getElementById('tkt-title');
    var status = document.getElementById('tkt-status');
    var cb = document.getElementById('tkt-close-btn');
    var comp = document.getElementById('tkt-composer');
    var inp = document.getElementById('tkt-input');
    var send = document.getElementById('tkt-send');
    if (title) title.textContent = 'Support ticket #' + t.number;
    if (status) {
      status.textContent = t.status === 'open' ? 'Open · staff replies appear here' : 'Closed';
      status.className = t.status === 'open' ? 'open' : 'closed';
    }
    if (cb) cb.style.display = t.status === 'open' ? '' : 'none';
    if (comp) comp.classList.toggle('disabled', t.status !== 'open');
    if (inp) inp.disabled = t.status !== 'open';
    if (send) send.disabled = t.status !== 'open';
    renderMessages();
  }
  function poll() {
    if (!ticket) return;
    api('/api/support/tickets/' + encodeURIComponent(ticket.id)).then(function (d) {
      if (!root) return;
      var t = d.ticket;
      ticket = t;
      var before = messages.length;
      (t.messages || []).forEach(function (m) {
        if (m && !msgIds.has(m.id)) { msgIds.add(m.id); messages.push(m); }
      });
      if (messages.length > before) {
        try {
          if (typeof desktopNotify === 'function') desktopNotify({ senderId: 'staff', sender: { name: 'Support' }, content: 'New support reply', type: 'text' });
        } catch (e) {}
      }
      if (t.status !== 'open' && timer) { clearInterval(timer); timer = null; }
      paint(t);
    }).catch(function () { /* keep polling */ });
  }
  function sendMessage() {
    if (sending || !ticket || ticket.status !== 'open') return;
    var inp = document.getElementById('tkt-input');
    if (!inp) return;
    var content = inp.value.trim();
    if (!content) return;
    sending = true;
    var send = document.getElementById('tkt-send');
    if (send) send.disabled = true;
    var body = { content: content };
    if (replyTarget) body.replyTo = replyTarget.id;
    api('/api/support/tickets/' + encodeURIComponent(ticket.id) + '/messages', { method: 'POST', body: JSON.stringify(body) }).then(function (d) {
      inp.value = '';
      inp.style.height = 'auto';
      if (d.message && !msgIds.has(d.message.id)) { msgIds.add(d.message.id); messages.push(d.message); }
      if (replyTarget) { replyTarget = null; renderReplyBar(); }
      renderMessages();
      if (send) send.disabled = false;
      sending = false;
    }).catch(function (err) {
      toast(err.message || 'Could not send.', 'error');
      if (send) send.disabled = false;
      sending = false;
    });
  }
  function closeTicket() {
    if (!ticket || ticket.status !== 'open') return;
    var overlay = el('div', 'tkt-confirm');
    var whom = escapeHTML(String(ticket.username || ticket.name || 'user'));
    overlay.innerHTML =
      '<div class="tkt-confirm-box"><b>Close support ticket</b>' +
      '<p>Close ticket <b>#' + ticket.number + '</b>? The Discord channel will be renamed to <b>closed-' + whom + '</b> and you will not be able to reply anymore.</p>' +
      '<div class="tkt-confirm-actions"><button type="button" class="tkt-btn ghost" id="tkt-close-no">Cancel</button><button type="button" class="tkt-btn danger" id="tkt-close-yes">Close ticket</button></div></div>';
    root.appendChild(overlay);
    document.getElementById('tkt-close-no').onclick = function () { overlay.remove(); };
    document.getElementById('tkt-close-yes').onclick = function () {
      overlay.remove();
      api('/api/support/tickets/' + encodeURIComponent(ticket.id) + '/close', { method: 'POST' }).then(function (d) {
        ticket = d.ticket;
        (d.ticket.messages || []).forEach(function (m) { if (m && !msgIds.has(m.id)) { msgIds.add(m.id); messages.push(m); } });
        if (timer) { clearInterval(timer); timer = null; }
        paint(ticket);
        toast('Ticket #' + ticket.number + ' closed.');
        try {
          if (window.NCSettings && window.NCSettings.isOpen && window.NCSettings.isOpen()) {
            window.NCSettings.close(true);
            window.NCSettings.open('support');
          }
        } catch (e) {}
      }).catch(function (err) { toast(err.message, 'error'); });
    };
  }
  function bindComposer() {
    var inp = document.getElementById('tkt-input');
    var send = document.getElementById('tkt-send');
    if (!inp || !send) return;
    inp.addEventListener('input', function () {
      inp.style.height = 'auto';
      inp.style.height = Math.min(140, Math.max(24, inp.scrollHeight)) + 'px';
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    send.addEventListener('click', sendMessage);
  }
  function tktReplyHTML(m) {
  var r = m && m.reply;
  if (!r) return '';
  return '<div class="tkt-reply" data-jump="' + r.id + '" onclick="NCSupport.tktJump(this)" title="Jump to replied message"><span class="tkt-rp-icon">↩</span><b>@' + escapeHTML(String(r.author || 'unknown')) + '</b><span class="tkt-rp-prev">' + escapeHTML(String(r.preview || '').slice(0, 150)) + '</span></div>';
}
function tktModal(title, bodyHtml, actionsHtml) {
  var overlay = el('div', 'tkt-confirm');
  overlay.innerHTML = '<div class="tkt-confirm-box"><div class="tkt-modal-title">' + title + '</div>' + bodyHtml + (actionsHtml ? '<div class="tkt-confirm-actions">' + actionsHtml + '</div>' : '') + '</div>';
  root.appendChild(overlay);
  return overlay;
}
function startReply(id) {
  var m = messages.find(function (x) { return x.id === id; }) || null;
  if (!m || m.kind === 'system') return;
  replyTarget = { id: m.id, author: m.author || (m.kind === 'user' ? 'You' : 'Support Team'), preview: String(m.content || '').slice(0, 150) };
  renderReplyBar();
  var inp = document.getElementById('tkt-input');
  if (inp) inp.focus();
}
function clearReply() { replyTarget = null; renderReplyBar(); }
function renderReplyBar() {
  var bar = root && document.getElementById('tkt-replybar');
  if (!bar) return;
  if (!replyTarget) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = '<span class="tkt-rp-icon">↩</span><span class="tkt-rp-text">Replying to <b>@' + escapeHTML(replyTarget.author) + '</b></span><span class="tkt-rp-prev">' + escapeHTML(replyTarget.preview) + '</span><button type="button" class="tkt-rp-x" aria-label="Cancel reply">×</button>';
  var x = bar.querySelector('.tkt-rp-x');
  if (x) x.onclick = clearReply;
}
function showMsgMenu(e) {
  if (!e) return false;
  e.preventDefault();
  e.stopPropagation();
  var el = e.currentTarget;
  if (!el || !el.dataset || !el.dataset.mid) return false;
  var id = el.dataset.mid;
  var kind = el.dataset.kind || '';
  closeMsgMenu();
  var mine = kind === 'user';
  var bar = document.createElement('div');
  bar.className = 'tkt-menu';
  bar.id = 'tkt-menu';
  bar.style.left = '0px';
  bar.style.top = '0px';
  bar.innerHTML = '<button type="button" data-act="reply">↩ &nbsp;Reply</button><button type="button" data-act="forward">⤴ &nbsp;Forward</button>' + (mine ? '<button type="button" data-act="edit">✎ &nbsp;Edit</button><button type="button" class="danger" data-act="delete">🗑 &nbsp;Delete</button>' : '');
  document.body.appendChild(bar);
  bar.querySelector('[data-act="reply"]').onclick = function () { closeMsgMenu(); startReply(id); };
  bar.querySelector('[data-act="forward"]').onclick = function () { closeMsgMenu(); forwardMessage(id); };
  if (mine) {
    bar.querySelector('[data-act="edit"]').onclick = function () { closeMsgMenu(); editMessage(id); };
    bar.querySelector('[data-act="delete"]').onclick = function () { closeMsgMenu(); deleteMessage(id); };
  }
  var X = Math.min(e.clientX, Math.max(8, window.innerWidth - bar.offsetWidth - 10));
  var Y = Math.min(e.clientY, Math.max(8, window.innerHeight - bar.offsetHeight - 10));
  bar.style.left = X + 'px';
  bar.style.top = Y + 'px';
  setTimeout(function () {
    document.addEventListener('mousedown', tktMenuOutside, true);
    document.addEventListener('keydown', tktMenuKey, true);
    document.addEventListener('scroll', closeMsgMenu, true);
    window.addEventListener('resize', closeMsgMenu);
  }, 0);
  return false;
}
function tktMenuOutside(e) {
  var el = document.getElementById('tkt-menu');
  if (el && e && e.target && !el.contains(e.target)) closeMsgMenu();
}
function tktMenuKey(e) { if (e.key === 'Escape' || e.key === 'Esc') closeMsgMenu(); }
function closeMsgMenu() {
  var el = document.getElementById('tkt-menu');
  if (el) el.remove();
  document.removeEventListener('mousedown', tktMenuOutside, true);
  document.removeEventListener('keydown', tktMenuKey, true);
  document.removeEventListener('scroll', closeMsgMenu, true);
  window.removeEventListener('resize', closeMsgMenu);
}
function forwardMessage(id) {
  var m = messages.find(function (x) { return x.id === id; }) || null;
  if (!m) return toast('Message not found.', 'error');
  var convs = (typeof conversations !== 'undefined' && Array.isArray(conversations) && conversations.length) ? conversations.filter(function (c) { return c && c.other; }) : [];
  if (!convs.length) { toast('No conversations to forward to yet.', 'error'); return; }
  var label = String(m.content || '').slice(0, 40);
  var rows = convs.map(function (c) {
    return '<div class="tkt-fwd-row"><strong>' + escapeHTML(c.other.name || c.other.username) + '</strong><small>@' + escapeHTML(c.other.username) + '</small><button type="button" class="tkt-btn ghost" data-cid="' + c.id + '">Send</button></div>';
  }).join('');
  var overlay = tktModal('Forward message', '<p class="tkt-fwd-label">Forwarding: <b>' + escapeHTML(label) + '</b></p><div class="tkt-fwd-list">' + rows + '</div>', '<button type="button" class="tkt-btn ghost" id="tkt-fwd-cancel">Cancel</button>');
  document.getElementById('tkt-fwd-cancel').onclick = function () { overlay.remove(); };
  overlay.querySelectorAll('[data-cid]').forEach(function (b) { b.onclick = function () { doForward(id, b.dataset.cid, overlay); }; });
}
function doForward(id, cid, overlay) {
  var m = messages.find(function (x) { return x.id === id; }) || null;
  if (!m) { overlay.remove(); return; }
  var payload = { conversationId: cid, type: 'text', content: m.content, forwarded: true };
  if (typeof socket !== 'undefined' && socket) {
    try { socket.emit('message', payload); overlay.remove(); toast('Message forwarded'); return; } catch (err) {}
  }
  api('/api/messages', { method: 'POST', body: JSON.stringify(payload) }).then(function () {
    overlay.remove();
    toast('Message forwarded');
  }).catch(function (err) { toast(err.message || 'Could not forward.', 'error'); });
}
function tktJump(node) {
  var r = (node && node.closest) ? node.closest('.tkt-reply') : null;
  var id = (r && r.dataset && r.dataset.jump) || '';
  if (!id) return;
  var target = document.querySelector('.tkt-msg[data-mid="' + id + '"]');
  if (!target) return toast('That message is no longer in this ticket.', 'error');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('tkt-flash');
  setTimeout(function () { target.classList.remove('tkt-flash'); }, 1400);
}
function editMessage(id) {
  var m = messages.find(function (x) { return x.id === id; }) || null;
  if (!m || m.kind !== 'user') return toast('Only your own messages can be edited.', 'error');
  var overlay = tktModal('Edit message', '<textarea id="tkt-edit-input" class="tkt-edit-input" rows="3">' + escapeHTML(m.content) + '</textarea>', '<button type="button" class="tkt-btn ghost" id="tkt-edit-cancel">Cancel</button><button type="button" class="tkt-btn primary" id="tkt-edit-save">Save</button>');
  var inp = document.getElementById('tkt-edit-input');
  document.getElementById('tkt-edit-cancel').onclick = function () { overlay.remove(); };
  inp.focus();
  try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) {}
  inp.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('tkt-edit-save').click(); } };
  document.getElementById('tkt-edit-save').onclick = function () {
    var val = String(inp.value);
    if (!val.trim()) return toast('Message cannot be empty.', 'error');
    api('/api/support/tickets/' + encodeURIComponent(ticket.id) + '/messages/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ content: val }) }).then(function (d) {
      var i = messages.findIndex(function (x) { return x.id === id; });
      if (i > -1) messages[i] = d.message;
      overlay.remove();
      lastRenderLen = -1;
      renderMessages();
      toast('Message edited');
    }).catch(function (err) { toast(err.message || 'Could not edit.', 'error'); });
  };
}
function deleteMessage(id) {
  var m = messages.find(function (x) { return x.id === id; }) || null;
  if (!m || m.kind !== 'user') return toast('Only your own messages can be deleted.', 'error');
  var overlay = tktModal('Delete message', '<p class="tkt-fwd-label">Delete this message for everyone? The copy in the Discord channel is removed too.</p>', '<button type="button" class="tkt-btn ghost" id="tkt-del-cancel">Cancel</button><button type="button" class="tkt-btn danger" id="tkt-del-yes">Delete</button>');
  document.getElementById('tkt-del-cancel').onclick = function () { overlay.remove(); };
  document.getElementById('tkt-del-yes').onclick = function () {
    api('/api/support/tickets/' + encodeURIComponent(ticket.id) + '/messages/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (d) {
      var i = messages.findIndex(function (x) { return x.id === id; });
      if (i > -1) messages.splice(i, 1);
      if (msgIds.has(id)) msgIds.delete(id);
      overlay.remove();
      lastRenderLen = -1;
      renderMessages();
      toast('Message deleted');
    }).catch(function (err) { toast(err.message || 'Could not delete.', 'error'); });
  };
}
function openChat(ticketId) {
    close();
    root = el('div', 'support-root');
    root.innerHTML =
      '<div class="tkt-shell">' +
        '<header class="tkt-head">' +
          '<div class="tkt-head-info"><b id="tkt-title">Support ticket</b><small id="tkt-status"></small></div>' +
          '<button type="button" class="tkt-btn danger" id="tkt-close-btn">Close ticket</button>' +
          '<button type="button" class="tkt-close" id="tkt-x" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="tkt-body" id="tkt-body"></div>' +
        '<div class="tkt-composer" id="tkt-composer">' +
          '<div class="tkt-replybar hidden" id="tkt-replybar"></div>' +
          '<div class="tkt-composer-row">' +
            '<textarea id="tkt-input" rows="1" placeholder="Describe your issue…"></textarea>' +
            '<button type="button" class="tkt-btn primary" id="tkt-send">Send</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    document.getElementById('tkt-x').onclick = close;
    document.getElementById('tkt-close-btn').onclick = closeTicket;
    document.addEventListener('keydown', onKey, true);
    loadTicket(ticketId).then(function (t) {
      paint(t);
      bindComposer();
      if (t.status === 'open') timer = setInterval(poll, POLL_MS);
      var inp = document.getElementById('tkt-input');
      if (inp) { try { inp.focus(); } catch (e) {} }
    }).catch(function (err) {
      close();
      toast(err.message || 'Could not open your ticket.', 'error');
    });
  }
  function openTicket() {
    api('/api/support/tickets').then(function (d) {
      if (d && d.open) return openChat(d.open.id);
      return api('/api/support/tickets', { method: 'POST' }).then(function (x) {
        if (!x || !x.ticket) throw new Error('Could not create a ticket right now.');
        return openChat(x.ticket.id);
      });
    }).catch(function (err) {
      toast(err.message || 'Could not open support.', 'error');
    });
  }

  window.NCSupport = { openTicket: openTicket, openChat: openChat, close: close, tktJump: tktJump };
  window.NCSupportMsgMenu = showMsgMenu;
})();