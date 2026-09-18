(function () {
  if (window.NCGif) return;

  var SAVED_KEY = 'nc_saved_gifs';

  var panel = null;
  var body = null;
  var search = null;
  var tab = 'trending';
  var query = '';
  var page = 1;
  var nextPage = null;
  var results = [];
  var loading = false;
  var configured = null;
  var provider = null;
  var debounce = null;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function saved() {
    try { var a = JSON.parse(localStorage.getItem(SAVED_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function isSaved(url) { return saved().some(function (g) { return g.url === url; }); }
  function toggleSave(g) {
    var a = saved();
    var i = -1;
    for (var k = 0; k < a.length; k++) if (a[k].url === g.url) { i = k; break; }
    if (i >= 0) a.splice(i, 1);
    else a.unshift({ url: g.url, preview: g.preview, title: g.title || '', provider: g.provider || '' });
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(a.slice(0, 100))); } catch (e) {}
    return i < 0;
  }

  function setEmpty(msg) {
    if (!body) return;
    body.innerHTML = '';
    body.appendChild(el('p', 'emoji-empty', msg));
  }

  function tile(g, i) {
    var b = el('button', 'gif-cell');
    b.type = 'button';
    b.dataset.i = i;
    var img = document.createElement('img');
    img.src = g.preview || g.url;
    img.alt = g.title || 'GIF';
    img.loading = 'lazy';
    var star = el('span', 'gif-star' + (isSaved(g.url) ? ' on' : ''), '\u2605');
    star.dataset.star = i;
    star.setAttribute('role', 'button');
    star.setAttribute('aria-label', 'Save GIF');
    star.title = 'Save GIF';
    b.appendChild(img);
    b.appendChild(star);
    return b;
  }

  function render() {
    if (!body) return;
    body.innerHTML = '';
    if (tab === 'saved') {
      var list = saved();
      if (!list.length) { body.appendChild(el('p', 'emoji-empty', 'No saved GIFs yet. Tap \u2605 on a GIF to save it here.')); return; }
      results = list;
    }
    if (tab !== 'saved' && !results.length) {
      body.appendChild(el('p', 'emoji-empty', configured === false
        ? 'No GIF provider configured. Add a KLIPY_API_KEY or GIPHY_API_KEY on the server.'
        : 'No GIFs found.'));
      return;
    }
    var grid = el('div', 'gif-grid');
    results.forEach(function (g, i) { grid.appendChild(tile(g, i)); });
    body.appendChild(grid);
    if (tab !== 'saved' && nextPage) {
      var more = el('button', 'gif-more', 'Load more');
      more.type = 'button';
      more.onclick = function () { load(false); };
      body.appendChild(more);
    }
  }

  function load(reset) {
    if (loading) return;
    if (tab === 'saved') { render(); return; }
    loading = true;
    if (reset) { page = 1; results = []; nextPage = null; setEmpty('Loading\u2026'); }
    var url = '/api/gifs?page=' + page + (query ? '&q=' + encodeURIComponent(query) : '');
    fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (out) {
        var d = out.d || {};
        if (!out.ok) throw new Error(d.error || ('HTTP ' + (out.ok ? 200 : 'error')));
        configured = d.configured;
        provider = d.provider || provider;
        nextPage = d.next || null;
        if (reset) results = [];
        results = results.concat(d.gifs || []);
        if (reset) page = 1;
        page = (d.page || page) + 1;
        loading = false;
        render();
        if (panel) {
          var foot = panel.querySelector('.gif-attrib');
          if (foot) {
            var names = (d.providers && d.providers.length ? d.providers : (d.provider ? [d.provider] : [])).map(function (n) { return n === 'klipy' ? 'KLIPY' : 'GIPHY'; });
            foot.textContent = names.length ? ('Powered by ' + names.join(' & ')) : '';
          }
        }
      })
      .catch(function () {
        loading = false;
        setEmpty('Could not load GIFs. Try again.');
      });
  }

  function send(g) {
    if (typeof active === 'undefined' || !active) { if (typeof toast === 'function') toast('Open a conversation first.', 'error'); return; }
    if (typeof sendMessage !== 'function') { if (typeof toast === 'function') toast('Messaging unavailable.', 'error'); return; }
    sendMessage(g.url, 'image');
    closePanel();
  }

  function place() {
    if (!panel) return;
    var btn = document.getElementById('media') || document.getElementById('gif');
    var r = btn ? btn.getBoundingClientRect() : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = Math.min(380, vw - 16);
    var ph = Math.min(470, Math.round(vh * 0.72));
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
    panel = el('div', 'emoji-panel gif-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'GIF picker');
    var channels = el('div', 'media-channels');
    var chE = el('button', 'media-channel', '\uD83D\uDE0A Emojis');
    chE.type = 'button';
    chE.onclick = function () { try { localStorage.setItem('nc_media_tab', 'emoji'); } catch (e) {} closePanel(); if (window.NCEmoji) window.NCEmoji.open(); };
    var chG = el('button', 'media-channel active', 'GIFs');
    chG.type = 'button';
    channels.appendChild(chE);
    channels.appendChild(chG);
    panel.appendChild(channels);

    var head = el('div', 'emoji-head');
    search = el('input', 'emoji-search');
    search.type = 'search';
    search.placeholder = 'Search GIFs\u2026';
    search.setAttribute('aria-label', 'Search GIFs');
    var close = el('button', 'emoji-close', '\u2715');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close GIF picker');
    head.appendChild(search);
    head.appendChild(close);

    var tabs = el('div', 'emoji-tabs');
    [['trending', '\uD83D\uDD25', 'Trending'], ['saved', '\u2605', 'Saved GIFs']].forEach(function (t) {
      var b = el('button', 'emoji-tab', t[1]);
      b.type = 'button';
      b.dataset.tab = t[0];
      b.title = t[2];
      tabs.appendChild(b);
    });

    body = el('div', 'emoji-body gif-body');
    var foot = el('div', 'emoji-foot gif-attrib', '');

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(body);
    panel.appendChild(foot);

    search.addEventListener('input', function () {
      clearTimeout(debounce);
      var v = this.value.trim();
      debounce = setTimeout(function () { query = v; load(true); }, 350);
    });
    close.addEventListener('click', closePanel);
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.emoji-tab');
      if (!b) return;
      tab = b.dataset.tab;
      Array.prototype.forEach.call(tabs.children, function (x) { x.classList.toggle('active', x.dataset.tab === tab); });
      if (tab === 'saved') render(); else load(true);
    });

    body.addEventListener('click', function (e) {
      var star = e.target.closest('.gif-star');
      if (star) {
        e.stopPropagation();
        var sg = results[Number(star.dataset.star)];
        if (sg) {
          var now = toggleSave(sg);
          star.classList.toggle('on', now);
          if (tab === 'saved') render();
        }
        return;
      }
      var cell = e.target.closest('.gif-cell');
      if (!cell) return;
      var g = results[Number(cell.dataset.i)];
      if (g) send(g);
    });
  }

  function onDocDown(e) {
    if (!panel) return;
    if (panel.contains(e.target)) return;
    var btn = document.getElementById('media') || document.getElementById('gif');
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
    if (window.NCEmoji && window.NCEmoji.close) window.NCEmoji.close();
    build();
    document.body.appendChild(panel);
    place();
    Array.prototype.forEach.call(panel.querySelectorAll('.emoji-tab'), function (x) { x.classList.toggle('active', x.dataset.tab === tab); });
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    if (window.visualViewport) { try { window.visualViewport.addEventListener('resize', place); } catch (e) {} }
    window.addEventListener('scroll', place, true);
    if (tab === 'saved') render(); else load(true);
    if (window.matchMedia('(min-width: 768px)').matches) search.focus();
  }

  function closePanel() {
    if (!panel) return;
    clearTimeout(debounce);
    panel.remove();
    panel = null;
    body = null;
    search = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    if (window.visualViewport) { try { window.visualViewport.removeEventListener('resize', place); } catch (e) {} }
    window.removeEventListener('scroll', place, true);
  }

  window.NCGif = { toggle: function () { if (panel) closePanel(); else openPanel(); }, open: openPanel, close: closePanel, isOpen: function () { return !!panel; } };

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('gif');
    if (b) b.addEventListener('click', function () { window.NCGif.toggle(); });
  });
})();
