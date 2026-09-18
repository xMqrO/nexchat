(function () {
  if (window.NCSettings) return;

  var CATS = [
    ['account', 'My Account', '\uD83D\uDC64', 'Profile, name and avatar'],
    ['appearance', 'Appearance', '\uD83C\uDFA8', 'Theme, mode and background'],
    ['notifications', 'Notifications', '\uD83D\uDD14', 'Sounds and alerts'],
    ['privacy', 'Privacy & Security', '\uD83D\uDD12', 'Reads, typing and password'],
    ['chat', 'Chat & Messaging', '\uD83D\uDCAC', 'Sending, media and history'],
    ['manage', 'Account Management', '\uD83D\uDEE1\uFE0F', 'Email, export and danger zone']
  ];
  var current = 'account';
  var root = null, navEl = null, bodyEl = null, titleEl = null;
  var returnTo = '/', pushed = false;
  var sysListenerOn = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function isOpen() { return !!root; }
  function catOf(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === id) return CATS[i];
    return CATS[0];
  }

  /* ---------- shared controls ---------- */
  function prefRow(key, title, desc, after) {
    var row = el('div', 'set-row');
    row.appendChild(el('div', 'grow', '<b>' + title + '</b><small>' + desc + '</small>'));
    var sw = el('button', 'switch' + (prefs()[key] ? ' on' : ''));
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', prefs()[key] ? 'true' : 'false');
    sw.appendChild(el('span'));
    sw.onclick = function () {
      var v = !sw.classList.contains('on');
      sw.disabled = true;
      var o = {};
      o[key] = v;
      savePrefs(o).then(function () {
        sw.classList.toggle('on', v);
        sw.setAttribute('aria-checked', String(v));
        sw.disabled = false;
        if (after) after(v);
      }, function (err) { sw.disabled = false; toast(err.message, 'error'); });
    };
    row.appendChild(sw);
    return row;
  }
  function field(label, inner) {
    var w = el('div', 'set-field', '<label>' + label + '</label>');
    w.appendChild(inner);
    return w;
  }
  function textInput(value, opts) {
    var i = document.createElement('input');
    i.value = value || '';
    if (opts) { if (opts.ph) i.placeholder = opts.ph; if (opts.type) i.type = opts.type; if (opts.max) i.maxLength = opts.max; if (opts.auto) i.autocomplete = opts.auto; }
    return i;
  }

  /* ---------- My Account ---------- */
  function renderAccount(body) {
    body.appendChild(el('p', 'set-lead', 'How you appear to everyone on NexChat.'));
    var top = el('div', 'settings-avatar');
    top.innerHTML = avatar(me, '') + '<div><button type="button" class="secondary" id="set-av-change">Change photo</button> ' +
      (me.avatar ? '<button type="button" class="secondary" id="set-av-remove">Remove</button>' : '') + '</div>';
    body.appendChild(top);
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    file.className = 'hidden';
    body.appendChild(file);
    var nameI = textInput(me.name || '', { max: 40, auto: 'nickname' });
    var userI = textInput(me.username || '', { max: 32, auto: 'username' });
    var bioI = document.createElement('textarea');
    bioI.rows = 3; bioI.maxLength = 160; bioI.value = me.bio || ''; bioI.placeholder = 'A line about you…';
    var colorI = document.createElement('input');
    colorI.type = 'color'; colorI.value = /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#8b7cf6';
    body.appendChild(field('Display name', nameI));
    body.appendChild(field('Username', userI));
    var avail = el('div', 'set-avail idle', me.username ? 'This is your current username.' : '');
    body.appendChild(avail);
    body.appendChild(field('Bio', bioI));
    body.appendChild(field('Accent color', colorI));
    var info = el('div', 'set-note', 'Email: <b>' + escapeHTML(me.email || '—') + '</b><br>Google: <b>' + (me.google ? 'linked ✓' : 'not linked') + '</b><br>Member since: <b>' + escapeHTML((me.createdAt || '').slice(0, 10) || '—') + '</b>');
    body.appendChild(info);
    var acts = el('div', 'set-actions');
    var save = el('button', 'primary', 'Save changes');
    acts.appendChild(save);
    body.appendChild(acts);

    var timer = null, seq = 0;
    userI.addEventListener('input', function () {
      var v = userI.value.trim();
      avail.className = 'set-avail idle';
      if (!v || v.length < 3) { avail.textContent = v ? 'Usernames need 3+ characters.' : ''; return; }
      if (v.toLowerCase() === String(me.username || '').toLowerCase()) { avail.textContent = 'This is your current username.'; return; }
      avail.textContent = 'Checking…';
      clearTimeout(timer);
      var my = ++seq;
      timer = setTimeout(function () {
        api('/api/users?q=' + encodeURIComponent(v)).then(function (d) {
          if (my !== seq) return;
          var taken = (d.users || []).some(function (u) { return String(u.username || '').toLowerCase() === v.toLowerCase(); });
          avail.className = 'set-avail ' + (taken ? 'bad' : 'ok');
          avail.textContent = taken ? '✕ @' + v + ' is taken.' : '✓ @' + v + ' is available.';
        }).catch(function () { if (my === seq) { avail.className = 'set-avail idle'; avail.textContent = ''; } });
      }, 400);
    });
    top.querySelector('#set-av-change').onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      var fd = new FormData();
      fd.append('image', f);
      toast('Uploading photo…');
      api('/api/avatar', { method: 'POST', body: fd }).then(function (d) {
        me = Object.assign({}, me, d.user);
        renderMe(); renderNav(); renderBody();
        toast('Profile picture updated');
      }).catch(function (err) { toast(err.message, 'error'); });
    };
    var rm = top.querySelector('#set-av-remove');
    if (rm) rm.onclick = function () {
      modal('Remove photo', '<p class="muted">Remove your profile picture?</p><div class="modal-actions"><button type="button" class="secondary" onclick="closeModal()">Cancel</button><button class="primary" id="avrm-yes" style="background:var(--danger)">Remove</button></div>');
      document.getElementById('avrm-yes').onclick = function () {
        api('/api/avatar/remove', { method: 'POST' }).then(function (d) {
          me = Object.assign({}, me, d.user);
          closeModal(); renderMe(); renderNav(); renderBody();
          toast('Profile picture removed');
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    };
    save.onclick = function () {
      save.disabled = true;
      api('/api/profile', { method: 'PUT', body: JSON.stringify({ name: nameI.value, username: userI.value, bio: bioI.value, color: colorI.value }) }).then(function (d) {
        me = Object.assign({}, me, d.user);
        renderMe(); renderNav();
        avail.className = 'set-avail idle';
        avail.textContent = 'This is your current username.';
        toast('Profile saved');
      }).catch(function (err) { toast(err.message, 'error'); }).then(function () { save.disabled = false; });
    };
  }

  /* ---------- Appearance ---------- */
  function sysMode() { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
  function followSys() { try { return localStorage.getItem('nc_follow_system') === '1'; } catch (e) { return false; } }
  function ensureSysListener() {
    if (sysListenerOn) return;
    sysListenerOn = true;
    try {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var f = function () { try { if (followSys() && me) applyAppearance(Object.assign({}, (me.appearance || savedAppearance), { mode: sysMode() })); } catch (e) {} };
      if (mq.addEventListener) mq.addEventListener('change', f);
      else if (mq.addListener) mq.addListener(f);
    } catch (e) {}
  }
  function renderAppearance(body) {
    ensureSysListener();
    if (me && me.appearance) savedAppearance = Object.assign({}, me.appearance);
    var pending = Object.assign({}, savedAppearance);
    var sys = followSys();
    var swatch = function (id, arr) { return '<button class="theme-swatch' + (pending.theme === id ? ' active' : '') + '" data-theme="' + id + '" title="' + APPEARANCE_THEMES[id] + '"><i style="background:' + arr[0] + '"></i><i style="background:' + arr[1] + '"></i><span>' + APPEARANCE_THEMES[id] + '</span></button>'; };
    var gswatch = function (id) { return '<button class="grad-swatch' + (pending.gradient === id ? ' active' : '') + '" data-gradient="' + id + '" title="' + APPEARANCE_GRADIENTS[id] + '"><i style="' + (GRAD_SWATCH[id] || 'background:var(--card2)') + '"></i><span>' + APPEARANCE_GRADIENTS[id] + '</span></button>'; };
    var render = function () {
      var modeNow = sys ? 'system' : pending.mode;
      body.innerHTML = '<p class="set-lead">Everything previews instantly. Save to keep it on all your devices, Reset to discard.</p>' +
        '<div class="set-section">Mode</div><div class="appearance-seg" id="set-mode">' +
        '<button class="' + (modeNow === 'light' ? 'active' : '') + '" data-mode="light">☀ &nbsp;Light</button>' +
        '<button class="' + (modeNow === 'dark' ? 'active' : '') + '" data-mode="dark">🌙 &nbsp;Dark</button>' +
        '<button class="' + (modeNow === 'system' ? 'active' : '') + '" data-mode="system">🖥 &nbsp;System</button></div>' +
        '<div class="set-section">Color theme</div><div class="appearance-grid">' +
        Object.keys(APPEARANCE_THEMES).map(function (k) { return swatch(k, THEME_SWATCH[k]); }).join('') + '</div>' +
        '<div class="set-section">Background</div><div class="appearance-grid">' +
        Object.keys(APPEARANCE_GRADIENTS).map(function (k) { return gswatch(k); }).join('') + '</div>' +
        '<div class="set-actions"><button class="primary" id="set-ap-save">Save appearance</button><button class="secondary" id="set-ap-reset">Reset</button></div>';
      Array.prototype.forEach.call(body.querySelectorAll('#set-mode [data-mode]'), function (b) {
        b.onclick = function () {
          var v = b.dataset.mode;
          sys = v === 'system';
          pending.mode = sys ? sysMode() : v;
          applyAppearance(pending);
          render();
        };
      });
      Array.prototype.forEach.call(body.querySelectorAll('.theme-swatch'), function (b) {
        b.onclick = function () { pending.theme = b.dataset.theme; applyAppearance(pending); render(); };
      });
      Array.prototype.forEach.call(body.querySelectorAll('.grad-swatch'), function (b) {
        b.onclick = function () { pending.gradient = b.dataset.gradient; applyAppearance(pending); render(); };
      });
      body.querySelector('#set-ap-save').onclick = function () {
        try { localStorage.setItem('nc_follow_system', sys ? '1' : '0'); } catch (e) {}
        var toSave = Object.assign({}, pending, { mode: sys ? sysMode() : pending.mode });
        api('/api/appearance', { method: 'PUT', body: JSON.stringify(toSave) }).then(function (d) {
          if (d.appearance) { me.appearance = d.appearance; savedAppearance = Object.assign({}, d.appearance); }
          applyAppearance(sys ? Object.assign({}, toSave, { mode: sysMode() }) : toSave);
          persistLocalAppearance(toSave);
          toast('Appearance saved');
        }).catch(function (err) { toast(err.message, 'error'); });
      };
      body.querySelector('#set-ap-reset').onclick = function () {
        pending = Object.assign({}, savedAppearance);
        sys = followSys();
        applyAppearance(Object.assign({}, pending, { mode: sys ? sysMode() : pending.mode }));
        render();
      };
    };
    render();
  }

  /* ---------- Notifications ---------- */
  function renderNotifications(body) {
    body.appendChild(el('p', 'set-lead', 'These live on this device and your account — sounds and desktop alerts for new messages.'));
    body.appendChild(prefRow('sound', 'Message sounds', 'Play a blip when a new message arrives.'));
    var dRow = el('div', 'set-row');
    dRow.appendChild(el('div', 'grow', '<b>Desktop notifications</b><small>Show a system notification when NexChat is in the background.</small>'));
    var dSw = el('button', 'switch' + (prefs().desktop ? ' on' : ''));
    dSw.type = 'button';
    dSw.appendChild(el('span'));
    dSw.onclick = function () {
      var v = !dSw.classList.contains('on');
      if (!('Notification' in window)) { toast('This browser does not support notifications.', 'error'); return; }
      dSw.disabled = true;
      var done = function (ok) {
        if (!ok) { dSw.disabled = false; return; }
        var o = { desktop: v };
        savePrefs(o).then(function () {
          dSw.classList.toggle('on', v);
          dSw.disabled = false;
          if (v) toast('Desktop notifications on');
        }, function (err) { dSw.disabled = false; toast(err.message, 'error'); });
      };
      if (v && Notification.permission !== 'granted') {
        try {
          Notification.requestPermission().then(function (p) {
            if (p !== 'granted') { toast('Permission denied — enable notifications in your browser settings.', 'error'); done(false); }
            else done(true);
          }).catch(function () { toast('Permission request failed.', 'error'); done(false); });
        } catch (e) { toast('Permission request failed.', 'error'); done(false); }
      } else done(true);
    };
    dRow.appendChild(dSw);
    body.appendChild(dRow);
    body.appendChild(prefRow('preview', 'Message previews', 'Include the message text in desktop notifications. Off shows just “New message”.'));
    var acts = el('div', 'set-actions');
    var test = el('button', 'secondary', 'Send test notification');
    test.onclick = function () {
      if (!('Notification' in window)) { toast('This browser does not support notifications.', 'error'); return; }
      if (Notification.permission !== 'granted') { toast('Allow notifications first (toggle above).', 'error'); return; }
      try { new Notification('NexChat', { body: 'This is how message notifications look.', silent: true }); try { playNotify(); } catch (e) {} }
      catch (e) { toast('Could not show notification.', 'error'); }
    };
    acts.appendChild(test);
    body.appendChild(acts);
  }

  /* ---------- Privacy & Security ---------- */
  function renderPrivacy(body) {
    body.appendChild(el('p', 'set-lead', 'What other people can see about you. Changes apply immediately.'));
    body.appendChild(prefRow('sendRead', 'Send read receipts', 'People see ✓✓ Read under messages you have opened. Off: they only ever see Delivered/Sent.'));
    body.appendChild(prefRow('sendTyping', 'Show typing indicator', 'People see when you are typing a message.'));
    body.appendChild(prefRow('invisible', 'Appear offline', 'Everyone sees you as offline. Your messages show as Sent until opened, since the app cannot tell others you are here.', function (v) {
      try { if (socket && socket.setPresenceEnabled) socket.setPresenceEnabled(!v); } catch (e) {}
    }));
    body.appendChild(el('div', 'set-section', 'Change password'));
    var cur = textInput('', { type: 'password', ph: 'Current password', auto: 'current-password' });
    var nxt = textInput('', { type: 'password', ph: 'New password (4+ characters)', auto: 'new-password' });
    var cfm = textInput('', { type: 'password', ph: 'Confirm new password', auto: 'new-password' });
    body.appendChild(field('Current password — leave blank for Google-created accounts', cur));
    body.appendChild(field('New password', nxt));
    body.appendChild(field('Confirm new password', cfm));
    var acts = el('div', 'set-actions');
    var save = el('button', 'primary', 'Change password');
    save.onclick = function () {
      if (nxt.value !== cfm.value) { toast('New passwords do not match.', 'error'); return; }
      save.disabled = true;
      api('/api/password', { method: 'POST', body: JSON.stringify({ current: cur.value, next: nxt.value }) }).then(function () {
        cur.value = ''; nxt.value = ''; cfm.value = '';
        toast('Password changed');
      }).catch(function (err) { toast(err.message, 'error'); }).then(function () { save.disabled = false; });
    };
    acts.appendChild(save);
    body.appendChild(acts);
  }

  /* ---------- Chat & Messaging ---------- */
  function renderChat(body) {
    body.appendChild(el('p', 'set-lead', 'How sending and messages behave for you.'));
    body.appendChild(prefRow('enterToSend', 'Enter to send', 'On: Enter sends, Shift+Enter adds a line. Off: Enter adds a line, use the Send button.'));
    body.appendChild(prefRow('autoplay', 'Autoplay videos', 'Play videos muted on a loop, like GIFs. Applies to newly rendered messages.'));
    body.appendChild(prefRow('noiseIsolation', 'Noise isolation', 'Filter background noise and echo while recording voice messages. Depends on device support.'));
    var tRow = el('div', 'set-row');
    tRow.appendChild(el('div', 'grow', '<b>Time format</b><small>How message times are displayed.</small>'));
    var seg = el('div', 'appearance-seg', '<button class="' + (prefs().timeFormat !== '24' ? 'active' : '') + '" data-tf="12">12-hour</button><button class="' + (prefs().timeFormat === '24' ? 'active' : '') + '" data-tf="24">24-hour</button>');
    seg.style.margin = '0';
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        savePrefs({ timeFormat: b.dataset.tf }).then(function () {
          Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.toggle('active', x === b); });
          rerenderTimes();
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    });
    tRow.appendChild(seg);
    body.appendChild(tRow);
    var recents = 0, saved = 0;
    try { recents = (JSON.parse(localStorage.getItem('nc_emoji_recent')) || []).length; } catch (e) {}
    try { saved = (JSON.parse(localStorage.getItem('nc_saved_gifs')) || []).length; } catch (e) {}
    var hRow = el('div', 'set-row');
    hRow.appendChild(el('div', 'grow', '<b>Emoji recents</b><small>' + recents + ' recently used emojis stored on this device.</small>'));
    var hBtn = el('button', 'secondary', 'Clear');
    hBtn.onclick = function () { try { localStorage.removeItem('nc_emoji_recent'); } catch (e) {} toast('Emoji recents cleared'); renderBody(); };
    hRow.appendChild(hBtn);
    body.appendChild(hRow);
    var gRow = el('div', 'set-row');
    gRow.appendChild(el('div', 'grow', '<b>Saved GIFs</b><small>' + saved + ' GIFs saved on this device.</small>'));
    var gBtn = el('button', 'secondary', 'Clear');
    gBtn.onclick = function () { try { localStorage.removeItem('nc_saved_gifs'); } catch (e) {} toast('Saved GIFs cleared'); renderBody(); };
    gRow.appendChild(gBtn);
    body.appendChild(gRow);
  }
  function rerenderTimes() {
    if (!active || !me) return;
    try {
      var items = [];
      msgById.forEach(function (m) { if (m.conversationId === active.id && m.id) items.push(m); });
      items.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
      renderMessages(items);
    } catch (e) {}
  }

  /* ---------- Account Management ---------- */
  function renderManage(body) {
    body.appendChild(el('p', 'set-lead', 'Your email, your data, and leaving NexChat.'));
    var em = textInput(me.email || '', { type: 'email', ph: 'you@example.com', auto: 'email' });
    body.appendChild(field('Email address', em));
    var acts = el('div', 'set-actions');
    var emSave = el('button', 'primary', 'Save email');
    emSave.onclick = function () {
      emSave.disabled = true;
      api('/api/email', { method: 'PUT', body: JSON.stringify({ email: em.value }) }).then(function (d) {
        me.email = d.email;
        renderNav();
        toast('Email updated');
      }).catch(function (err) { toast(err.message, 'error'); }).then(function () { emSave.disabled = false; });
    };
    acts.appendChild(emSave);
    var exp = el('button', 'secondary', 'Export my data');
    exp.onclick = function () { exportData(exp); };
    acts.appendChild(exp);
    var out = el('button', 'secondary', 'Log out');
    out.onclick = function () { api('/api/logout', { method: 'POST' }).catch(function () {}).then(function () { location.reload(); }); };
    acts.appendChild(out);
    body.appendChild(acts);
    var dz = el('div', 'danger-zone');
    dz.appendChild(el('div', 'set-section', 'Danger zone'));
    var dRow = el('div', 'set-row');
    dRow.appendChild(el('div', 'grow', '<b>Delete account</b><small>Permanently removes your profile, messages and conversations for everyone. This cannot be undone.</small>'));
    var dBtn = el('button', 'btn-danger', 'Delete…');
    dBtn.onclick = confirmDelete;
    dRow.appendChild(dBtn);
    dz.appendChild(dRow);
    body.appendChild(dz);
  }
  function exportData(btn) {
    btn.disabled = true;
    toast('Preparing export…');
    api('/api/me').then(function (md) {
      return api('/api/conversations').then(function (cd) { return { me: md.user, convs: cd.conversations || [] }; });
    }).then(function (ctx) {
      var chain = Promise.resolve();
      var out = { exportedAt: new Date().toISOString(), user: ctx.me, conversations: [] };
      ctx.convs.forEach(function (c) {
        chain = chain.then(function () {
          return api('/api/messages/' + c.id).then(function (d) {
            out.conversations.push({ id: c.id, other: c.other, messages: d.messages });
          });
        });
      });
      return chain.then(function () { return out; });
    }).then(function (out) {
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nexchat-export.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} a.remove(); }, 5000);
      toast('Export downloaded');
    }).catch(function (err) { toast(err.message, 'error'); }).then(function () { btn.disabled = false; });
  }
  function confirmDelete() {
    modal('Delete account', '<p class="muted">Type your <b>password</b> to confirm. Google-created accounts without a password: set one in Privacy &amp; Security first, or type <b>DELETE</b> below.</p>' +
      '<label>Password<input id="del-pw" type="password" autocomplete="current-password"></label>' +
      '<div class="modal-actions"><button type="button" class="secondary" onclick="closeModal()">Cancel</button><button class="primary" id="del-next" style="background:var(--danger)">Continue</button></div>');
    document.getElementById('del-next').onclick = function () {
      var pw = document.getElementById('del-pw').value;
      modal('Are you sure?', '<p class="muted">Last chance. Type your username <b>' + escapeHTML(me.username) + '</b> to permanently delete your account.</p>' +
        '<label>Username<input id="del-user" autocomplete="off"></label>' +
        '<div class="modal-actions"><button type="button" class="secondary" onclick="closeModal()">Cancel</button><button class="primary" id="del-yes" style="background:var(--danger)">Delete my account</button></div>');
      document.getElementById('del-yes').onclick = function () {
        if (document.getElementById('del-user').value.trim().toLowerCase() !== String(me.username).toLowerCase()) { toast('Username does not match.', 'error'); return; }
        var payload = pw === 'DELETE' ? { confirm: true } : { password: pw };
        api('/api/account', { method: 'DELETE', body: JSON.stringify(payload) }).then(function () { location.reload(); }).catch(function (err) { toast(err.message, 'error'); });
      };
    };
  }

  /* ---------- shell ---------- */
  function build() {
    root = el('div', 'settings-root');
    var shell = el('div', 'settings-shell');
    navEl = el('aside', 'settings-nav');
    var panel = el('section', 'settings-panel');
    var head = el('header', 'settings-panel-head');
    var back = el('button', 'settings-back', '←');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to categories');
    back.onclick = function () { root.classList.remove('settings-show-panel'); };
    titleEl = el('h2', '', 'Settings');
    var x = el('button', 'settings-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close settings');
    x.onclick = function () { close(false); };
    head.appendChild(back);
    head.appendChild(titleEl);
    head.appendChild(x);
    bodyEl = el('div', 'settings-body');
    panel.appendChild(head);
    panel.appendChild(bodyEl);
    shell.appendChild(navEl);
    shell.appendChild(panel);
    root.appendChild(shell);
  }
  function renderNav() {
    navEl.innerHTML = '<div class="settings-title">Settings</div>' +
      '<div class="settings-user">' + avatar(me, '') + '<div class="meta"><b>' + escapeHTML(me.name || me.username) + '</b><small>@' + escapeHTML(me.username) + '</small></div></div>';
    CATS.forEach(function (c) {
      var b = el('button', 'set-cat' + (c[0] === current ? ' active' : ''), '<span class="ic">' + c[2] + '</span><span>' + c[1] + '<small>' + c[3] + '</small></span>');
      b.type = 'button';
      b.onclick = function () { current = c[0]; renderNav(); renderBody(); root.classList.add('settings-show-panel'); };
      navEl.appendChild(b);
    });
    var sp = el('div', 'spacer');
    navEl.appendChild(sp);
  }
  var RENDER = { account: renderAccount, appearance: renderAppearance, notifications: renderNotifications, privacy: renderPrivacy, chat: renderChat, manage: renderManage };
  function renderBody() {
    var c = catOf(current);
    titleEl.textContent = c[1];
    bodyEl.innerHTML = '';
    bodyEl.classList.remove('swap');
    void bodyEl.offsetWidth;
    bodyEl.classList.add('swap');
    try { bodyEl.scrollTop = 0; } catch (e) {}
    RENDER[c[0]](bodyEl);
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopImmediatePropagation(); close(false); }
  }
  function open(cat) {
    if (typeof me === 'undefined' || !me) return;
    if (cat) current = catOf(cat)[0];
    if (!root) {
      build();
      document.body.appendChild(root);
      try { document.body.style.overflow = 'hidden'; } catch (e) {}
      document.addEventListener('keydown', onKey, true);
    }
    renderNav();
    renderBody();
    if (!pushed) {
      try { returnTo = location.pathname + location.search; history.pushState({ settings: true }, '', '/settings'); } catch (e) {}
      pushed = true;
    }
  }
  function close(silent) {
    if (!root) return;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    root = null; navEl = null; bodyEl = null; titleEl = null;
    try { document.body.style.overflow = ''; } catch (e) {}
    if (!silent && pushed) { try { history.pushState(null, '', returnTo || '/'); } catch (e) {} }
    pushed = false;
  }

  window.NCSettings = { open: open, close: close, isOpen: isOpen };
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('settings-trigger');
    if (b) b.onclick = function () { window.NCSettings.open(); };
  });
})();
