(function () {
  'use strict';
  var GOD = 'xmqrO'.toLowerCase();
  var tab = 'overview';
  var relTime = function (ts) {
    if (!ts) return '—';
    var m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.floor(m / 60) + 'h ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  var ipRow = function (ip) { return '<span class="admin-mono">' + escapeHTML(ip || '—') + '</span>'; };
  function tabsHtml() {
    var list = [['overview', 'Overview'], ['online', 'Online & IPs'], ['chats', 'All chats'], ['owners', 'Owners'], ['bans', 'Bans'], ['visits', 'Visits']];
    return '<div class="admin-tabs">' + list.map(function (t) { return '<button class="admin-tab' + (tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="admin-body"></div>';
  }
  window.openAdminDashboard = function () { modal('Admin dashboard', tabsHtml()); $$('.admin-tab').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; $$('.admin-tab').forEach(function (x) { x.classList.toggle('active', x === b); }); loadTab(tab); }; }); loadTab(tab); };
  function adminError(body, err) { body.innerHTML = '<p style="color:var(--danger);font-size:13px">' + escapeHTML(err.message || 'Something went wrong.') + '</p>'; }
  async function loadTab(t) {
    var body = $('#admin-body');
    if (!body) return;
    body.innerHTML = '<p class="muted" style="font-size:13px">Loading…</p>';
    try { await tabs[t](); } catch (err) { adminError(body, err); }
  }
  async function doBan(ip, who) {
    if (!ip || ip === '—') return toast('No IP recorded for this user.', 'error');
    if (!window.confirm('Ban IP ' + ip + (who ? ' (' + who + ')' : '') + '?\nThey will be blocked from the site immediately.')) return;
    try { await api('/api/admin/ban', { method: 'PUT', body: JSON.stringify({ ip: ip, reason: 'Banned by ' + (who || 'admin') }) }); toast('IP banned: ' + ip); if (tab === 'online') tabs.online(); else loadTab('bans'); } catch (err) { toast(err.message, 'error'); }
  }
  function reloadCurrent(fn) { fn(); }
  async function doUnban(ip) {
    if (!window.confirm('Unban IP ' + ip + '?')) return;
    try { await api('/api/admin/unban', { method: 'PUT', body: JSON.stringify({ ip: ip }) }); toast('IP unbanned: ' + ip); loadTab('bans'); } catch (err) { toast(err.message, 'error'); }
  }
  async function doBadge(userId, action, isGod) {
    var label = action === 'grant' ? 'grant the Owner badge' : 'remove the Owner badge';
    if (window.confirm('Are you sure you want to ' + label + '?')) {
      try { await api('/api/admin/badge', { method: 'PUT', body: JSON.stringify({ userId: userId, action: action }) }); toast(action === 'grant' ? 'Owner badge granted.' : 'Owner badge removed.'); loadTab('owners'); } catch (err) { toast(err.message, 'error'); }
    }
  }
  window.doBan = doBan;
  window.doUnban = doUnban;
  window.doBadge = doBadge;

  var tabs = {};
  tabs.overview = async function () {
    var d = await api('/api/admin/stats');
    var body = $('#admin-body');
    var cards = [['Users', d.users], ['Conversations', d.conversations], ['Messages', d.messages], ['Online now', d.online], ['Owners', (d.owners || []).length], ['Banned IPs', (d.bans || []).length]];
    body.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' + cards.map(function (c) { return '<div class="admin-stat"><b>' + c[1] + '</b><small>' + c[0] + '</small></div>'; }).join('') + '</div>' +
      '<div style="display:grid;gap:6px;font-size:13px"><div class="admin-row"><span>👀</span><span class="grow">Total website visits</span><strong>' + (d.visits.total || 0) + '</strong></div><div class="admin-row"><span>📈</span><span class="grow">Visits today (' + escapeHTML(d.visits.day || '—') + ')</span><strong>' + (d.visits.today || 0) + '</strong></div></div>' +
      '<p class="muted" style="font-size:12px;margin-top:16px">Owners with the 👑 badge: ' + d.owners.map(escapeHTML).join(', ') + '</p>' +
      '<button class="secondary" style="margin-top:12px" onclick="closeModal()">Close</button>';
  };
  tabs.online = async function () {
    var d = await api('/api/admin/online');
    var online = d.online || [], recent = d.recent || [];
    var body = $('#admin-body');
    var rows = online.map(function (r) {
      var u = r.user || { username: '?', color: '#8b7cf6' };
      return '<div class="admin-row">' + avatar(u) + '<div class="grow"><strong>' + escapeHTML(u.name || u.username) + (u.owner ? ' 👑' : '') + '</strong> <span class="admin-mono">@' + escapeHTML(u.username) + '</span><div class="admin-mono">IP ' + ipRow(r.ip) + ' · ' + escapeHTML(r.ua || '') + '</div></div><button class="secondary" style="font-size:12px" data-ip="' + escapeHTML(r.ip || '') + '" data-who="' + escapeHTML(u.username || '') + '" onclick="doBan(this.dataset.ip,this.dataset.who)">⛔ Ban</button></div>';
    }).join('') || '<p class="muted" style="font-size:13px">No one is connected right now.</p>';
    var recentRows = recent.map(function (r) {
      var u = r.user || { username: '?', color: '#8b7cf6' };
      return '<div class="admin-row">' + avatar(u) + '<div class="grow"><strong>' + escapeHTML(u.name || u.username) + (u.owner ? ' 👑' : '') + '</strong> <span class="admin-mono">@' + escapeHTML(u.username) + '</span><div class="admin-mono">IP ' + ipRow(r.ip) + ' · last seen ' + relTime(r.seen) + '</div></div><button class="secondary" style="font-size:12px" data-ip="' + escapeHTML(r.ip || '') + '" data-who="' + escapeHTML(u.username || '') + '" onclick="doBan(this.dataset.ip,this.dataset.who)">⛔ Ban</button></div>';
    }).join('') || '<p class="muted" style="font-size:13px">No connections recorded yet.</p>';
    body.innerHTML = '<h4 style="margin:0 0 8px">Connected now</h4>' + rows + '<h4 style="margin:18px 0 8px">Recent connections</h4>' + recentRows + '<p class="muted" style="font-size:12px;margin-top:8px">IP addresses are logged for security. Owners and admins have full access to this list.</p>';
  };
  tabs.chats = async function () {
    var d = await api('/api/admin/conversations');
    var body = $('#admin-body');
    var rows = (d.conversations || []).map(function (c) {
      var names = c.members.map(function (m) { return '<strong>' + escapeHTML(m.name || m.username) + (m.owner ? ' 👑' : '') + '</strong>'; }).join(' <span class="admin-mono">↔</span> ');
      var last = c.lastMessage ? (c.lastMessage.type === 'image' ? '📷 Photo' : escapeHTML(String(c.lastMessage.content).slice(0, 60))) : 'no messages yet';
      return '<div class="admin-row"><div class="grow">' + names + '<div class="admin-mono">' + c.messageCount + ' messages · last ' + relTime(c.lastMessage && new Date(c.lastMessage.createdAt).getTime()) + '</div><div style="font-size:12px;color:var(--muted)">' + last + '</div></div><button class="secondary" style="font-size:12px" onclick="openAdminChat(\'' + c.id + '\')">👁 Enter chat</button></div>';
    }).join('') || '<p class="muted" style="font-size:13px">No conversations yet.</p>';
    body.innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 8px">All conversations on the platform — open one to moderate it like your own chat.</p>' + rows;
  };
  tabs.owners = async function () {
    var d = await api('/api/admin/users');
    var body = $('#admin-body');
    var rows = (d.users || []).map(function (u) {
      var isGod = u.username.toLowerCase() === GOD;
      var has = u.owner;
      var btn = isGod
        ? '<span class="admin-mono" style="font-size:11px">Protected</span>'
        : '<button class="secondary" style="font-size:12px" onclick="doBadge(\'' + u.id + '\',\'' + (has ? 'revoke' : 'grant') + '\')">' + (has ? '👑 Remove badge' : '＋ Give badge') + '</button>';
      return '<div class="admin-row">' + avatar(u) + '<div class="grow"><strong>' + escapeHTML(u.name || u.username) + (has ? ' <span class="admin-badge">OWNER</span>' : '') + '</strong> <span class="admin-mono">@' + escapeHTML(u.username) + '</span><div class="admin-mono">' + escapeHTML(u.email || 'no email') + ' · last IP ' + escapeHTML(u.lastIp || '—') + ' · seen ' + relTime(u.lastSeen) + '</div></div>' + btn + '</div>';
    }).join('');
    body.innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 8px">Badge holders get full admin powers. The main admin cannot be changed and cannot be banned by anyone.</p>' + rows;
  };
  tabs.bans = async function () {
    var d = await api('/api/admin/bans');
    var body = $('#admin-body');
    var rows = (d.bans || []).map(function (b) {
      return '<div class="admin-row"><span class="admin-mono">⛔ ' + escapeHTML(b.ip) + '</span><div class="grow"><div style="font-size:12px">' + escapeHTML(b.reason || '') + '</div><div class="admin-mono">by ' + escapeHTML(b.byName || b.by || 'admin') + ' · ' + relTime(b.at) + '</div></div><button class="secondary" style="font-size:12px" onclick="doUnban(\'' + b.ip + '\')">Unban</button></div>';
    }).join('') || '<p class="muted" style="font-size:13px">No banned IPs.</p>';
    body.innerHTML = '<form id="ban-form" style="display:flex;gap:8px;margin-bottom:12px"><input name="ip" placeholder="IP address to ban" required style="flex:1"><input name="reason" placeholder="Reason (optional)"><button class="primary" style="flex-shrink:0">Ban IP</button></form>' + rows;
    $('#ban-form').onsubmit = async function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      var ip = String(f.get('ip') || '').trim();
      if (!ip) return toast('Enter an IP.', 'error');
      try { await api('/api/admin/ban', { method: 'PUT', body: JSON.stringify({ ip: ip, reason: String(f.get('reason') || '') }) }); toast('Banned: ' + ip); loadTab('bans'); } catch (err) { toast(err.message, 'error'); }
    };
  };
  tabs.visits = async function () {
    var d = await api('/api/admin/visits');
    var body = $('#admin-body');
    var year = d.year || {};
    var days = [];
    var fmt = function (d2) { return String(d2.getFullYear()) + '-' + String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0'); };
    for (var i = 6; i >= 0; i--) { var dt = new Date(Date.now() - i * 86400000); days.push({ key: fmt(dt), label: dt.toLocaleDateString(undefined, { weekday: 'short' }), n: year[fmt(dt)] || 0 }); }
    var max = Math.max(1, Math.max.apply(null, days.map(function (x) { return x.n; })));
    var bars = days.map(function (x) { return '<i style="height:' + Math.max(3, Math.round((x.n / max) * 100)) + '%" title="' + x.label + ': ' + x.n + '"></i>'; }).join('');
    var labels = days.map(function (x) { return '<span style="font-size:10px;color:var(--muted);text-align:center;flex:1">' + x.n + '</span>'; }).join('');
    document.querySelector('#admin-body').innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div class="admin-stat"><b>' + (d.total || 0) + '</b><small>Total visits</small></div><div class="admin-stat"><b>' + (d.today || 0) + '</b><small>Today</small></div></div>' +
      '<p class="muted" style="font-size:12px;margin:0 0 4px">Visits — last 7 days</p><div class="admin-days">' + bars + '</div><div style="display:flex">' + labels + '</div>' +
      '<h4 style="margin:20px 0 8px">Recent visitors</h4>' + (d.recent || []).map(function (r) { return '<div class="admin-row"><span class="admin-mono">' + escapeHTML(r.ip) + '</span><div class="grow"><span class="admin-mono">' + escapeHTML(r.path) + '</span><div class="admin-mono">' + escapeHTML(r.ua || '') + '</div></div><span style="font-size:12px;color:var(--muted)">' + relTime(r.at) + '</span></div>'; }).join('') || '<p class="muted" style="font-size:13px">No visits yet.</p>';
  };

  window.openAdminChat = async function (convId) {
    if (!window.openOversightChat) return toast('Chat module is not ready.', 'error');
    try {
      var d = await api('/api/admin/conversations/' + convId);
      openOversightChat(d.conversation);
    } catch (err) { toast(err.message, 'error'); }
  };
})();