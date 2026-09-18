(function () {
  if (window.NCEmoji) return;

  var RECENT_KEY = 'nc_emoji_recent';
  var FAV_KEY = 'nc_emoji_favs';
  var GROUPS = [
    [0, 'Smileys & Emotion', '\uD83D\uDE00'],
    [1, 'People & Body', '\uD83E\uDDD1'],
    [3, 'Animals & Nature', '\uD83D\uDC3B'],
    [4, 'Food & Drink', '\uD83C\uDF54'],
    [5, 'Travel & Places', '\u2708\uFE0F'],
    [6, 'Activities', '\u26BD'],
    [7, 'Objects', '\uD83D\uDCA1'],
    [8, 'Symbols', '\u2764\uFE0F'],
    [9, 'Flags', '\uD83D\uDEA9']
  ];

  var panel = null;
  var data = null;
  var byChar = null;
  var loadPromise = null;
  var tab = 'recent';
  var query = '';

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (res, rej) {
      if (window.EMOJI_DATA) { data = window.EMOJI_DATA; index(); return res(); }
      var s = document.createElement('script');
      s.src = '/emoji-data.js';
      s.onload = function () { data = window.EMOJI_DATA || []; index(); res(); };
      s.onerror = function () { rej(new Error('Could not load emoji data.')); };
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  function index() {
    byChar = new Map();
    data.forEach(function (r) { byChar.set(r[0], r); });
  }

  function read(key) {
    try { var a = JSON.parse(localStorage.getItem(key)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function recent() { return read(RECENT_KEY); }
  function favs() { return read(FAV_KEY); }
  function isFav(ch) { return favs().indexOf(ch) >= 0; }

  function saveRecent(ch) {
    var a = recent().filter(function (x) { return x !== ch; });
    a.unshift(ch);
    if (a.length > 36) a = a.slice(0, 36);
    write(RECENT_KEY, a);
  }
  function toggleFav(ch) {
    var a = favs();
    var i = a.indexOf(ch);
    if (i >= 0) a.splice(i, 1); else a.unshift(ch);
    write(FAV_KEY, a);
    return i < 0;
  }

  function cell(ch, label) {
    var b = el('button', 'emoji-cell', ch);
    b.type = 'button';
    b.dataset.e = ch;
    if (label) b.title = label;
    if (isFav(ch)) b.classList.add('is-fav');
    return b;
  }

  function renderBody() {
    if (!panel) return;
    var body = panel.querySelector('.emoji-body');
    if (!body) return;
    body.innerHTML = '';
    body.scrollTop = 0;

    if (query) {
      if (!data) { body.appendChild(el('p', 'emoji-empty', 'Loading\u2026')); return; }
      var q = query.toLowerCase();
      var res = [], seen = {};
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (r[2].indexOf(q) < 0) continue;
        if (seen[r[0]]) continue;
        seen[r[0]] = 1;
        res.push(r);
        if (res.length >= 240) break;
      }
      if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No emoji found for \u201C' + query + '\u201D')); return; }
      var rg = el('div', 'emoji-grid');
      res.forEach(function (r) { rg.appendChild(cell(r[0], r[1])); });
      body.appendChild(rg);
      return;
    }

    if (tab === 'recent' || tab === 'fav') {
      var chars = tab === 'recent' ? recent() : favs();
      if (!chars.length) {
        body.appendChild(el('p', 'emoji-empty', tab === 'recent'
          ? 'No recently used emojis yet.'
          : 'No favorites yet. Long-press or right-click an emoji to favorite it.'));
        return;
      }
      var g = el('div', 'emoji-grid');
      chars.forEach(function (ch) { var r = byChar && byChar.get(ch); g.appendChild(cell(ch, r ? r[1] : '')); });
      body.appendChild(g);
      return;
    }

    if (!data) { body.appendChild(el('p', 'emoji-empty', 'Loading\u2026')); return; }
    var grp = Number(tab);
    var grid = el('div', 'emoji-grid');
    data.forEach(function (r) { if (r[3] === grp) grid.appendChild(cell(r[0], r[1])); });
    body.appendChild(grid);
  }

  function renderTabs() {
    if (!panel) return;
    var wrap = panel.querySelector('.emoji-tabs');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.children, function (b) {
      b.classList.toggle('active', !query && b.dataset.tab === tab);
    });
  }

  function insert(ch) {
    var inp = document.getElementById('message-input');
    if (!inp) return;
    var s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    var e = inp.selectionEnd == null ? s : inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + ch + inp.value.slice(e);
    var pos = s + ch.length;
    try { inp.focus(); inp.setSelectionRange(pos, pos); } catch (_) {}
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    saveRecent(ch);
  }

  function place() {
    if (!panel) return;
    var btn = document.getElementById('media') || document.getElementById('emoji');
    var r = btn ? btn.getBoundingClientRect() : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = Math.min(360, vw - 16);
    var ph = Math.min(390, Math.round(vh * 0.62));
    panel.style.width = pw + 'px';
    panel.style.height = ph + 'px';
    var left = r ? r.left : 16;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    var bottom = r ? (vh - r.top + 8) : 80;
    bottom = Math.max(8, Math.min(bottom, vh - ph - 8));
    panel.style.left = left + 'px';
    panel.style.bottom = bottom + 'px';
  }

  function build() {
    panel = el('div', 'emoji-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Emoji picker');
    var channels = el('div', 'media-channels');
    var chE = el('button', 'media-channel active', '\uD83D\uDE0A Emojis');
    chE.type = 'button';
    var chG = el('button', 'media-channel', 'GIFs');
    chG.type = 'button';
    chG.onclick = function () { try { localStorage.setItem('nc_media_tab', 'gif'); } catch (e) {} closePanel(); if (window.NCGif) window.NCGif.open(); };
    channels.appendChild(chE);
    channels.appendChild(chG);
    panel.appendChild(channels);

    var head = el('div', 'emoji-head');
    var search = el('input', 'emoji-search');
    search.type = 'search';
    search.placeholder = 'Search emoji\u2026';
    search.setAttribute('aria-label', 'Search emoji');
    var close = el('button', 'emoji-close', '\u2715');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close emoji picker');
    head.appendChild(search);
    head.appendChild(close);

    var tabs = el('div', 'emoji-tabs');
    [['recent', '\uD83D\uDD58', 'Recently used'], ['fav', '\u2605', 'Favorites']].forEach(function (t) {
      var b = el('button', 'emoji-tab', t[1]);
      b.type = 'button';
      b.dataset.tab = t[0];
      b.title = t[2];
      tabs.appendChild(b);
    });
    GROUPS.forEach(function (g) {
      var b = el('button', 'emoji-tab', g[2]);
      b.type = 'button';
      b.dataset.tab = String(g[0]);
      b.title = g[1];
      tabs.appendChild(b);
    });

    var body = el('div', 'emoji-body');
    body.appendChild(el('p', 'emoji-empty', 'Loading\u2026'));

    var foot = el('div', 'emoji-foot', 'Long-press or right-click an emoji to add it to favorites');

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(foot);

    search.addEventListener('input', function () { query = this.value.trim(); renderTabs(); renderBody(); });
    close.addEventListener('click', closePanel);
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.emoji-tab');
      if (!b) return;
      tab = b.dataset.tab;
      query = '';
      var s = panel.querySelector('.emoji-search');
      if (s) s.value = '';
      renderTabs();
      renderBody();
    });

    body.addEventListener('click', function (e) {
      var c = e.target.closest('.emoji-cell');
      if (!c) return;
      if (c._long) { c._long = false; return; }
      insert(c.dataset.e);
    });
    body.addEventListener('contextmenu', function (e) {
      var c = e.target.closest('.emoji-cell');
      if (!c) return;
      e.preventDefault();
      c.classList.toggle('is-fav', toggleFav(c.dataset.e));
    });

    var timer = null, pressed = null;
    body.addEventListener('pointerdown', function (e) {
      var c = e.target.closest('.emoji-cell');
      if (!c) return;
      pressed = c;
      c._long = false;
      timer = setTimeout(function () {
        if (!pressed) return;
        pressed._long = true;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        pressed.classList.toggle('is-fav', toggleFav(pressed.dataset.e));
      }, 500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      body.addEventListener(ev, function () { clearTimeout(timer); pressed = null; });
    });
  }

  function onDocDown(e) {
    if (!panel) return;
    if (panel.contains(e.target)) return;
    var btn = document.getElementById('media') || document.getElementById('emoji');
    if (btn && btn.contains(e.target)) return;
    closePanel();
  }
  function onKey(e) {
    if (!panel) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePanel();
    }
  }

  function openPanel() {
    if (panel) { closePanel(); return; }
    build();
    document.body.appendChild(panel);
    place();
    renderTabs();
    renderBody();
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    if (window.visualViewport) { try { window.visualViewport.addEventListener('resize', place); } catch (e) {} }
    window.addEventListener('scroll', place, true);
    load().then(function () { renderBody(); }).catch(function () {
      if (!panel) return;
      var b = panel.querySelector('.emoji-body');
      if (b) { b.innerHTML = ''; b.appendChild(el('p', 'emoji-empty', 'Could not load emoji. Check your connection.')); }
    });
    var s = panel.querySelector('.emoji-search');
    if (s && window.matchMedia('(min-width: 768px)').matches) s.focus();
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    if (window.visualViewport) { try { window.visualViewport.removeEventListener('resize', place); } catch (e) {} }
    window.removeEventListener('scroll', place, true);
  }

  window.NCEmoji = { toggle: function () { if (panel) closePanel(); else openPanel(); }, open: openPanel, close: closePanel, isOpen: function () { return !!panel; } };

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('emoji');
    if (b && !b.textContent.trim()) b.textContent = '\uD83D\uDE0A';
  });
})();
