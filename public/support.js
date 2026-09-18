(function () {
  if (window.NCSupport) return;

  var POLL_MS = 3000;
  var root = null, ticket = null, messages = [], msgIds = new Set(), timer = null, sending = false, lastRenderLen = -1;

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
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener('keydown', onKey, true);
    if (root) { root.remove(); root = null; }
    ticket = null; messages = []; msgIds = new Set(); lastRenderLen = -1;
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
        html += '<div class="tkt-msg staff"><div class="tkt-bubble"><b>' + escapeHTML(String(m.author || 'Support Team')) + '</b><span>' + linkify(escapeHTML(String(m.content || ''))) + '</span></div><small>' + time(m.createdAt) + '</small></div>';
      } else {
        html += '<div class="tkt-msg mine"><div class="tkt-bubble"><b>You</b><span>' + linkify(escapeHTML(String(m.content || ''))) + '</span></div><small>' + time(m.createdAt) + '</small></div>';
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
    api('/api/support/tickets/' + encodeURIComponent(ticket.id) + '/messages', { method: 'POST', body: JSON.stringify({ content: content }) }).then(function (d) {
      inp.value = '';
      inp.style.height = 'auto';
      if (d.message && !msgIds.has(d.message.id)) { msgIds.add(d.message.id); messages.push(d.message); }
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
    modal('Close support ticket', '<p class="muted">Close ticket <b>#' + ticket.number + '</b>? The Discord channel will be renamed to <b>closed ticket</b> and you will not be able to reply anymore.</p><div class="modal-actions"><button type="button" class="secondary" onclick="closeModal()">Cancel</button><button class="primary" id="tkt-close-yes">Close ticket</button></div>');
    document.getElementById('tkt-close-yes').onclick = function () {
      closeModal();
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
  function openChat(ticketId) {
    close();
    root = el('div', 'support-root');
    root.innerHTML =
      '<div class="tkt-shell">' +
        '<header class="tkt-head">' +
          '<div class="tkt-head-info"><b id="tkt-title">Support ticket</b><small id="tkt-status"></small></div>' +
          '<button type="button" class="tkt-btn ghost" id="tkt-close-btn">Close ticket</button>' +
          '<button type="button" class="tkt-close" id="tkt-x" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="tkt-body" id="tkt-body"></div>' +
        '<div class="tkt-composer" id="tkt-composer">' +
          '<textarea id="tkt-input" rows="1" placeholder="Describe your issue…"></textarea>' +
          '<button type="button" class="tkt-btn primary" id="tkt-send">Send</button>' +
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

  window.NCSupport = { openTicket: openTicket, openChat: openChat, close: close };
})();