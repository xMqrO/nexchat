(function () {
  if (window.NCMedia) return;
  var KEY = 'nc_media_tab';
  function tab() {
    try { var t = localStorage.getItem(KEY); return t === 'gif' ? 'gif' : 'emoji'; }
    catch (e) { return 'emoji'; }
  }
  function open() {
    if (tab() === 'gif') { if (window.NCGif) window.NCGif.open(); }
    else if (window.NCEmoji) window.NCEmoji.open();
  }
  function toggle() {
    var eOpen = !!(window.NCEmoji && window.NCEmoji.isOpen && window.NCEmoji.isOpen());
    var gOpen = !!(window.NCGif && window.NCGif.isOpen && window.NCGif.isOpen());
    if (eOpen || gOpen) {
      if (window.NCEmoji && window.NCEmoji.close) window.NCEmoji.close();
      if (window.NCGif && window.NCGif.close) window.NCGif.close();
    } else open();
  }
  window.NCMedia = { toggle: toggle, open: open, tab: tab };
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('media');
    if (b) b.addEventListener('click', toggle);
  });
})();
