/* 1-on-1 voice/video calls: UI overlay + production wiring over NCCallCore + NCCallSignal. */
(function () {
  if (window.NCCall) return;

  var registry = {};
  var activeCall = null;
  var signalReady = null;
  var remoteAudio = null;
  var ringTimer = null;
  var ringCtx = null;
  var durTimer = null;
  var overlay = null;
  var lastPeer = null;
  var persistentOverlay = null;
  var persistentStream = null;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function toastLocal(m, k) { try { if (typeof toast === 'function') toast(m, k); } catch (e) {} }

  function reasonText(r) {
    return { declined: 'Declined', busy: 'Busy', offline: 'User is offline', 'no-answer': 'No answer', missed: 'Missed call', cancelled: 'Cancelled', ended: 'Call ended', failed: 'Connection failed' }[r] || 'Call ended';
  }
  function stateText(ctrl) {
    var s = ctrl.call.state;
    if (s === 'calling') return 'Calling…';
    if (s === 'ringing') return ctrl.call.dir === 'in' ? (ctrl.call.video ? 'Incoming video call' : 'Incoming call') : 'Ringing…';
    if (s === 'connecting') return 'Connecting…';
    if (s === 'reconnecting') return 'Reconnecting…';
    return '';
  }
  function hasLocalVideo(ctrl) {
    try { return !!(ctrl.call.stream && ctrl.call.stream.getVideoTracks && ctrl.call.stream.getVideoTracks().length); } catch (e) { return false; }
  }
  function isVideoCall(ctrl) { return !!(ctrl.call.video || ctrl.call.remoteVideo || hasLocalVideo(ctrl)); }

  /* ---------- ringtone ---------- */
  function ringStop() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
    if (ringCtx) { try { ringCtx.close(); } catch (e) {} ringCtx = null; }
  }
  function ringStart(kind) {
    ringStop();
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      ringCtx = ctx;
      var play = function (f, t, dur) {
        try {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g); g.connect(ctx.destination);
          o.start(t); o.stop(t + dur + 0.05);
        } catch (e) {}
      };
      var beep = function () {
        try {
          var t = ctx.currentTime;
          if (kind === 'in') { play(880, t, 0.35); play(880, t + 0.5, 0.35); }
          else { play(440, t, 0.4); }
        } catch (e) {}
      };
      beep();
      ringTimer = setInterval(beep, kind === 'in' ? 1800 : 2500);
    } catch (e) {}
  }

  /* ---------- remote media ---------- */
  function remoteAudioEl() {
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'call-remote-audio';
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      document.body.appendChild(remoteAudio);
    }
    return remoteAudio;
  }
  function attachRemote(stream, kind) {
    if (!stream) return;
    try {
      var a = remoteAudioEl();
      a.srcObject = stream;
      var p = a.play(); if (p && p.catch) p.catch(function () {});
    } catch (e) {}
    var v = overlay && overlay.querySelector('.call-remote-video');
    if (v && kind === 'video') {
      try {
        v.srcObject = stream;
        var pv = v.play(); if (pv && pv.catch) pv.catch(function () {});
      } catch (e) {}
    }
  }
  function detachRemote() {
    try { if (remoteAudio) remoteAudio.srcObject = null; } catch (e) {}
    try { var v = overlay && overlay.querySelector('.call-remote-video'); if (v) v.srcObject = null; } catch (e) {}
  }

  /* ---------- overlay ---------- */
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s -= m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtBitrate(bps) {
    if (!bps) return '—';
    if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
    if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps';
    return bps + ' bps';
  }
  function ensureOverlay(ctrl) {
    closeOverlay();
    overlay = el('div', 'call-overlay');
    overlay.innerHTML =
      '<div class="call-card">' +
        '<video class="call-remote-video" autoplay playsinline></video>' +
        '<div class="call-avatar"></div>' +
        '<div class="call-local-wrap"><video class="call-local-video" autoplay playsinline muted></video></div>' +
        '<div class="call-head"><div class="call-name"></div><div class="call-state"></div><div class="call-timer hidden">0:00</div></div>' +
        '<div class="call-quality hidden"><select class="quality-select" title="Video quality"></select><select class="fps-select" title="Frame rate"></select><span class="quality-stats"></span></div>' +
        '<div class="call-quality-viewer hidden"><span class="quality-stats"></span></div>' +
        '<div class="call-btns"></div>' +
        '<audio class="call-remote-audio" autoplay></audio>' +
      '</div>' +
      '<div class="call-screen-indicator"><span>🖥 Sharing screen</span><button class="stop-btn" type="button">Stop</button></div>';
    document.body.appendChild(overlay);
    var indicator = overlay.querySelector('.call-screen-indicator');
    var stopBtn = indicator.querySelector('.stop-btn');
    stopBtn.onclick = function () {
      if (ctrl.toggleScreenShare) ctrl.toggleScreenShare().catch(function (e) { toastLocal(e.message, 'error'); });
    };
    var qs = overlay.querySelector('.quality-select');
    var fs = overlay.querySelector('.fps-select');
    if (qs && window.NCCallCore && NCCallCore.QUALITY_PRESETS) {
      var presets = NCCallCore.PRESET_ORDER || [];
      presets.forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = k;
        opt.textContent = NCCallCore.QUALITY_PRESETS[k].label;
        qs.appendChild(opt);
      });
      qs.value = ctrl.call.quality || '1080p';
      qs.onchange = function () {
        if (ctrl.setQuality) ctrl.setQuality(qs.value).catch(function (e) { toastLocal(e.message, 'error'); qs.value = ctrl.call.quality; });
      };
    }
    if (fs && window.NCCallCore && NCCallCore.FPS_PRESETS) {
      NCCallCore.FPS_PRESETS.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        fs.appendChild(opt);
      });
      fs.value = ctrl.call.targetFPS || 30;
      fs.onchange = function () {
        var fps = parseInt(fs.value, 10);
        if (ctrl.setFPS) ctrl.setFPS(fps).catch(function (e) { toastLocal(e.message, 'error'); fs.value = ctrl.call.targetFPS; });
      };
    }
    paint(ctrl);
  }
  function closeOverlay() {
    if (durTimer) { clearInterval(durTimer); durTimer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }
  function ensurePersistentOverlay(stream) {
    if (persistentOverlay) return persistentOverlay;
    persistentOverlay = document.createElement('div');
    persistentOverlay.className = 'call-persistent-overlay';
    persistentOverlay.innerHTML =
      '<div class="persistent-header">' +
        '<span class="persistent-title">🖥 Screen Preview</span>' +
        '<div class="persistent-controls">' +
          '<button class="persistent-btn minimize" title="Minimize">−</button>' +
          '<button class="persistent-btn close" title="Close">×</button>' +
        '</div>' +
      '</div>' +
      '<video class="persistent-video" autoplay playsinline muted></video>';
    document.body.appendChild(persistentOverlay);
    var video = persistentOverlay.querySelector('.persistent-video');
    if (stream) video.srcObject = stream;
    var dragHandle = persistentOverlay.querySelector('.persistent-header');
    var isDragging = false, offsetX = 0, offsetY = 0;
    dragHandle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - persistentOverlay.offsetLeft;
      offsetY = e.clientY - persistentOverlay.offsetTop;
      persistentOverlay.style.transition = 'none';
    });
    document.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      persistentOverlay.style.left = (e.clientX - offsetX) + 'px';
      persistentOverlay.style.top = (e.clientY - offsetY) + 'px';
      persistentOverlay.style.right = 'auto';
      persistentOverlay.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { isDragging = false; persistentOverlay.style.transition = ''; });
    persistentOverlay.querySelector('.persistent-btn.close').onclick = function () { hidePersistentOverlay(); };
    persistentOverlay.querySelector('.persistent-btn.minimize').onclick = function () { persistentOverlay.classList.toggle('minimized'); };
    return persistentOverlay;
  }
  function showPersistentOverlay(stream) {
    var ov = ensurePersistentOverlay(stream);
    ov.classList.remove('hidden', 'minimized');
    var video = ov.querySelector('.persistent-video');
    if (stream && video.srcObject !== stream) video.srcObject = stream;
    persistentStream = stream;
  }
  function hidePersistentOverlay() {
    if (persistentOverlay) persistentOverlay.classList.add('hidden');
  }
  function togglePersistentOverlay(stream) {
    if (persistentOverlay && !persistentOverlay.classList.contains('hidden')) hidePersistentOverlay();
    else showPersistentOverlay(stream);
  }
  function updatePersistentStream(stream) {
    if (!persistentOverlay) return;
    var video = persistentOverlay.querySelector('.persistent-video');
    if (stream && video.srcObject !== stream) video.srcObject = stream;
    persistentStream = stream;
  }
  function paint(ctrl) {
    if (!overlay) return;
    var peer = ctrl.peer || {};
    var video = isVideoCall(ctrl);
    var card = overlay.querySelector('.call-card');
    card.classList.toggle('video', video);
    overlay.querySelector('.call-name').textContent = peer.name || peer.username || 'Unknown';
    overlay.querySelector('.call-state').textContent = stateText(ctrl);

    var av = overlay.querySelector('.call-avatar');
    av.textContent = (peer.name || peer.username || '?').slice(0, 1).toUpperCase();
    try { av.style.background = peer.color || '#8b7cf6'; } catch (e) {}
    var remoteOn = video && !!(ctrl.call.remoteVideo) && ctrl.call.state !== 'ringing';
    av.classList.toggle('hidden', remoteOn);

    var localWrap = overlay.querySelector('.call-local-wrap');
    var localVid = overlay.querySelector('.call-local-video');
    var isScreenShare = !!ctrl.call.screenShare;
    var localStream = isScreenShare ? ctrl.call.screenStream : ctrl.call.stream;
    var showLocal = video && localStream && ctrl.call.videoOn && ctrl.call.state !== 'ended';
    localWrap.classList.toggle('hidden', !showLocal);
    if (showLocal && localVid.srcObject !== localStream) {
      try { localVid.srcObject = localStream; var p = localVid.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    } else if (showLocal && isScreenShare) {
      try { localVid.play().catch(function () {}); } catch (e) {}
    }
    var rv = overlay.querySelector('.call-remote-video');
    if (ctrl._remoteStream && rv.srcObject !== ctrl._remoteStream) {
      try { rv.srcObject = ctrl._remoteStream; var pv = rv.play(); if (pv && pv.catch) pv.catch(function () {}); } catch (e) {}
    } else if (ctrl.call.remoteScreenShare) {
      try { rv.play().catch(function () {}); } catch (e) {}
    }

    var timerEl = overlay.querySelector('.call-timer');
    var s = ctrl.call.state;
    if (s === 'connected' || s === 'reconnecting') {
      timerEl.classList.remove('hidden');
      var base = ctrl.call.connectedAt || Date.now();
      var tick = function () { try { timerEl.textContent = fmtClock(Date.now() - base); } catch (e) {} };
      tick();
      if (durTimer) clearInterval(durTimer);
      durTimer = setInterval(tick, 1000);
    } else {
      timerEl.classList.add('hidden');
      if (durTimer) { clearInterval(durTimer); durTimer = null; }
    }

    var qualityEl = overlay.querySelector('.call-quality');
    var qs = overlay.querySelector('.quality-select');
    var statsEl = overlay.querySelector('.quality-stats');
    var isHost = ctrl.call.dir === 'out' || ctrl.call.screenShare; // local user controls quality when they're the host/screen sharer
    var showQuality = video && (s === 'connected' || s === 'reconnecting') && isHost;
    if (qualityEl) qualityEl.classList.toggle('hidden', !showQuality);
    if (statsEl && ctrl.call.stats) {
      var st = ctrl.call.stats.inbound || ctrl.call.stats; // show inbound (received) quality
      statsEl.textContent = (st.width && st.height ? st.width + '×' + st.height : '—') +
        (st.fps ? ' @ ' + st.fps + ' fps' : '') +
        (st.bitrate ? ' · ' + fmtBitrate(st.bitrate) : '');
    }
    if (qs) qs.value = ctrl.call.quality || '1080p';
    var fs = overlay.querySelector('.fps-select');
    if (fs) fs.value = ctrl.call.targetFPS || 30;

    var viewerEl = overlay.querySelector('.call-quality-viewer');
    var viewerStatsEl = viewerEl && viewerEl.querySelector('.quality-stats');
    var showViewer = video && (s === 'connected' || s === 'reconnecting') && !isHost;
    if (viewerEl) viewerEl.classList.toggle('hidden', !showViewer);
    if (viewerStatsEl && ctrl.call.stats) {
      var st = ctrl.call.stats.inbound || ctrl.call.stats;
      viewerStatsEl.textContent = (st.width && st.height ? st.width + '×' + st.height : '—') +
        (st.fps ? ' @ ' + st.fps + ' fps' : '') +
        (st.bitrate ? ' · ' + fmtBitrate(st.bitrate) : '');
    }

    var indicator = overlay.querySelector('.call-screen-indicator');
    if (indicator) indicator.classList.toggle('visible', !!ctrl.call.screenShare);

    var btns = overlay.querySelector('.call-btns');
    btns.innerHTML = '';
    var mk = function (label, cls, title, fn) {
      var b = el('button', 'call-btn ' + cls, label);
      b.type = 'button'; b.title = title;
      b.onclick = fn;
      btns.appendChild(b);
      return b;
    };
    if (s === 'ringing' && ctrl.call.dir === 'in') {
      mk('✓', 'accept', 'Accept', function () { ctrl.accept(); });
      mk('✕', 'decline', 'Decline', function () { ctrl.decline(); });
    } else if (s === 'calling' || s === 'ringing' || s === 'connecting') {
      mk(ctrl.call.muted ? '🔇' : '🔊', 'mute' + (ctrl.call.muted ? ' on' : ''), 'Mute', function () { ctrl.toggleMute(); paint(ctrl); });
      mk('🎥', 'cam' + (ctrl.call.videoOn ? ' on' : ''), 'Camera', function () { ctrl.toggleVideo().then(function () { paint(ctrl); }); });
      mk('✕', 'end', 'Cancel', function () { if (ctrl.call.dir === 'out') ctrl.cancel(); else ctrl.end(); });
    } else if (s === 'connected' || s === 'reconnecting') {
      mk(ctrl.call.muted ? '🔇' : '🔊', 'mute' + (ctrl.call.muted ? ' on' : ''), 'Mute', function () { ctrl.toggleMute(); paint(ctrl); });
      mk('🎥', 'cam' + (ctrl.call.videoOn ? ' on' : ''), 'Camera', function () { ctrl.toggleVideo().then(function () { paint(ctrl); }); });
      if (ctrl.call.videoOn) mk('🔄', 'flip', 'Switch camera', function () { ctrl.switchCamera(); });
      if (ctrl.toggleScreenShare) mk(ctrl.call.screenShare ? '🖥️' : '🖥', 'screen' + (ctrl.call.screenShare ? ' on' : ''), ctrl.call.screenShare ? 'Stop screen share' : 'Share screen', function () { ctrl.toggleScreenShare().then(function () { paint(ctrl); }).catch(function (e) { toastLocal(e.message, 'error'); paint(ctrl); }); });
      var localStreamForPreview = ctrl.call.screenShare ? ctrl.call.screenStream : (ctrl.call.stream || null);
      mk(ctrl.call.screenShare && persistentOverlay && !persistentOverlay.classList.contains('hidden') ? '📌' : '📍', 'pin' + (ctrl.call.screenShare && persistentOverlay && !persistentOverlay.classList.contains('hidden') ? ' on' : ''), 'Toggle persistent preview', function () { togglePersistentOverlay(localStreamForPreview); paint(ctrl); });
      if (video) mk('⛶', 'full', 'Fullscreen', function () { toggleFullscreen(); });
      mk('📞', 'end', 'End call', function () { ctrl.end(); });
    }
  }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (overlay && overlay.requestFullscreen) overlay.requestFullscreen();
    } catch (e) {}
  }

  function uiFor(ctrl) {
    return function (state, call, stream, kind) {
      if (state === 'remote-track') { if (kind === 'video') ctrl._remoteStream = stream; attachRemote(stream, kind); paint(ctrl); return; }
      if (state === 'remote-media') { paint(ctrl); return; }
      if (state === 'stats') { paint(ctrl); return; }
      if (state === 'screen-share-start' || state === 'screen-share-stop') { 
        var stream = ctrl.call.screenShare ? ctrl.call.screenStream : (ctrl.call.stream || null);
        updatePersistentStream(stream); 
        paint(ctrl); 
        return; 
      }
      if (state === 'media-error') { toastLocal((stream && stream.message) || 'Camera unavailable.', 'error'); paint(ctrl); return; }
      if (state === 'ringing' && ctrl.call.dir === 'in') ringStart('in');
      else if (state === 'ringing') ringStart('out');
      else ringStop();
      if (state === 'connected' || state === 'reconnecting' || state === 'connecting' || state === 'calling' || state === 'ringing') {
        if (!overlay) ensureOverlay(ctrl);
        else paint(ctrl);
      }
      if (state === 'ended') {
        ringStop();
        var r = ctrl.call.reason || 'ended';
        if (r === 'missed') {
          try { toastLocal('Missed call from ' + (ctrl.peer.name || ctrl.peer.username)); } catch (e) {}
        }
        if (/-local$/.test(r)) { unregister(ctrl); closeOverlay(); hidePersistentOverlay(); }
        else {
          if (!overlay) ensureOverlay(ctrl);
          overlay.querySelector('.call-state').textContent = reasonText(r);
          overlay.querySelector('.call-btns').innerHTML = '';
          setTimeout(function () { unregister(ctrl); closeOverlay(); }, 1600);
        }
      }
    };
  }

  function register(ctrl) {
    if (ctrl.call.id) registry[ctrl.call.id] = ctrl;
    if (activeCall && activeCall !== ctrl && !activeCall.call.ended) {
      try { activeCall.end(); } catch (e) {}
    }
    activeCall = ctrl;
    try { lastPeer = { id: ctrl.peerId, callId: ctrl.call.id }; } catch (e) {}
  }
  function unregister(ctrl) {
    if (ctrl.call.id && registry[ctrl.call.id] === ctrl) delete registry[ctrl.call.id];
    if (activeCall === ctrl) activeCall = null;
    detachRemote();
  }
  function makeController(cfg) {
    var holder = {};
    var ctrl = window.NCCallCore.create({
      me: cfg.me, peerId: cfg.peerId, peer: cfg.peer,
      conversationId: cfg.conversationId, callId: cfg.callId, dir: cfg.dir, video: cfg.video,
      transport: cfg.transport, api: cfg.api,
      timeouts: cfg.timeouts, iceServers: cfg.iceServers,
      RTCPeerConnection: cfg.RTCPeerConnection, getUserMedia: cfg.getUserMedia,
      setTimeout: cfg.setTimeout, clearTimeout: cfg.clearTimeout,
      quality: cfg.quality || 'medium',
      fps: cfg.fps || null,
      afterMic: function (stream) { return (window.NCCallAudio ? window.NCCallAudio.enhance(stream) : Promise.resolve(stream)); },
      releaseMic: function (stream) { try { if (window.NCCallAudio) window.NCCallAudio.release(stream); } catch (e) {} },
      onState: function (s, c, st, k) { if (holder.ui) holder.ui(s, c, st, k); }
    });
    holder.ui = uiFor(ctrl);
    ctrl.peer = cfg.peer;
    ctrl.peerId = cfg.peerId;
    return ctrl;
  }

  /* ---------- signaling ---------- */
  function ensureSignal() {
    if (signalReady) return signalReady;
    signalReady = (typeof api === 'function' ? api('/api/calls/config') : Promise.reject(new Error('offline')))
      .then(function (cfg) {
        if (!cfg || !cfg.enabled) throw new Error('Calls are not configured on this server.');
        if (!window.NCCallSignal) throw new Error('Signaling library missing.');
        return window.NCCallSignal.connect({ url: cfg.url, anonKey: cfg.anonKey, userId: me.id });
      })
      .then(function () {
        window.NCCallSignal.onMessage(routeSignal);
        return true;
      })
      .catch(function (e) { signalReady = null; throw e; });
    return signalReady;
  }
  function findConvForPeer(peerId) {
    try {
      var list = (typeof conversations !== 'undefined' && conversations) || [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.other && c.other.id === peerId) return c;
        if (c.members && c.members.indexOf(peerId) !== -1) return c;
      }
    } catch (e) {}
    return null;
  }
  function routeSignal(msg) {
    if (!window.NCCallCore || !NCCallCore.isCallSignal(msg)) return;
    if (typeof me === 'undefined' || !me || msg.from === me.id) return;
    var ctrl = msg.callId && registry[msg.callId];
    if (ctrl) { ctrl.onSignal(msg); return; }
    if (activeCall && !activeCall.call.ended && activeCall.call.id && activeCall.call.id === msg.callId) { activeCall.onSignal(msg); return; }
    if (msg.t !== 'offer' || !msg.ticket || msg.renegotiate) return;
    if (activeCall && !activeCall.call.ended) {
      try { window.NCCallSignal.send(msg.from, { t: 'busy', callId: msg.callId, from: me.id }).catch(function () {}); } catch (e) {}
      return;
    }
    var conv = findConvForPeer(msg.from);
    if (!conv) return;
    var peer = conv.other || { id: msg.from };
    var incoming = makeController({
      me: me, peerId: msg.from, peer: peer,
      conversationId: msg.conv || conv.id,
      callId: msg.callId, dir: 'in',
      transport: window.NCCallSignal, api: api
    });
    register(incoming);
    var post = (typeof api === 'function'
      ? api('/api/calls/verify', { method: 'POST', body: JSON.stringify({ ticket: msg.ticket }) })
      : Promise.reject(new Error('offline')));
    post.then(function (d) {
      if (!d || !d.call) throw new Error('gone');
      ensureOverlay(incoming);
      incoming.incoming(msg, d.call);
    }).catch(function () {
      unregister(incoming);
      closeOverlay();
    });
  }

  /* ---------- public actions ---------- */
  function startCall(video) {
    if (typeof active === 'undefined' || !active) { toastLocal('Open a conversation first.', 'error'); return; }
    if (typeof me === 'undefined' || !me) return;
    if (activeCall && !activeCall.call.ended) { toastLocal('You are already in a call.', 'error'); return; }
    var peer = active.other;
    ensureSignal().then(function () {
      var ctrl = makeController({
        me: me, peerId: peer.id, peer: peer,
        conversationId: active.id, video: !!video,
        transport: window.NCCallSignal, api: api
      });
      register(ctrl);
      ensureOverlay(ctrl);
      ctrl.start().then(function () { register(ctrl); }, function () { register(ctrl); });
    }).catch(function (e) { toastLocal((e && e.message) || 'Could not start the call.', 'error'); });
  }

  try {
    window.addEventListener('pagehide', function () {
      try {
        if (activeCall && !activeCall.call.ended && lastPeer) {
          try { if (window.NCCallSignal) window.NCCallSignal.send(lastPeer.id, { t: 'end', callId: lastPeer.callId, from: (typeof me !== 'undefined' && me && me.id) || 'x' }).catch(function () {}); } catch (e) {}
          try { fetch('/api/calls/' + lastPeer.callId + '/end', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(function () {}); } catch (e) {}
        }
      } catch (e) {}
    });
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('call-btn');
    if (b) b.addEventListener('click', function () { startCall(false); });
    var v = document.getElementById('video-call-btn');
    if (v) v.addEventListener('click', function () { startCall(true); });
  });

  window.NCCall = {
    start: function () { startCall(false); },
    startVideo: function () { startCall(true); },
    init: function () { return ensureSignal().then(function () { return true; }, function () { return false; }); },
    active: function () { return activeCall; },
    _route: routeSignal,
    _make: makeController,
    _registry: registry
  };
})();
