/* 1-on-1 voice calls: WebRTC media (P2P) + realtime broadcast signaling.
 * NCCallCore.create(opts) is a dependency-free call controller (testable).
 * The NCCall UI/production glue below it uses app globals. */
(function () {
  if (window.NCCallCore) return;

  var SIG_TYPES = ['offer', 'answer', 'ice', 'decline', 'busy', 'cancel', 'end', 'media'];
  var DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

  function isCallSignal(m) {
    return !!m && typeof m === 'object' && SIG_TYPES.indexOf(m.t) !== -1 &&
      typeof m.callId === 'string' && !!m.callId && typeof m.from === 'string' && !!m.from;
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function micConstraints() {
    try {
      if (typeof prefs === 'function' && prefs().noiseIsolation === false) return true;
    } catch (e) {}
    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  }

  var QUALITY_PRESETS = {
    'data-saver': { label: 'Data Saver (480p@30)', width: 854, height: 480, fps: [15, 30], maxBitrate: 500000, screenBitrate: 2000000 },
    '720p': { label: '720p HD', width: 1280, height: 720, fps: [30, 60], maxBitrate: 2500000, screenBitrate: 8000000 },
    '1080p': { label: '1080p Full HD', width: 1920, height: 1080, fps: [30, 60], maxBitrate: 5000000, screenBitrate: 15000000 },
    '1440p': { label: '1440p QHD', width: 2560, height: 1440, fps: [30, 60], maxBitrate: 8000000, screenBitrate: 20000000 },
    '4k': { label: '4K UHD', width: 3840, height: 2160, fps: [30, 60], maxBitrate: 20000000, screenBitrate: 30000000 },
    '21:9-1080': { label: '21:9 Ultrawide (1080p)', width: 2560, height: 1080, fps: [30, 60], maxBitrate: 6000000, screenBitrate: 20000000 },
    '21:9-1440': { label: '21:9 Ultrawide (1440p)', width: 3440, height: 1440, fps: [30, 60], maxBitrate: 10000000, screenBitrate: 25000000 },
    '21:9-4k': { label: '21:9 Ultrawide (4K)', width: 5120, height: 2160, fps: [30, 60], maxBitrate: 25000000, screenBitrate: 40000000 }
  };
  var PRESET_ORDER = ['data-saver', '720p', '1080p', '1440p', '4k', '21:9-1080', '21:9-1440', '21:9-4k'];
  var DEFAULT_PRESET = '1080p';

  var FPS_PRESETS = [
    { value: 15, label: '15 fps (low bandwidth)' },
    { value: 24, label: '24 fps (cinematic)' },
    { value: 30, label: '30 fps (standard)' },
    { value: 60, label: '60 fps (smooth)' },
    { value: 120, label: '120 fps (high refresh)' },
    { value: 144, label: '144 fps (gaming)' },
    { value: 240, label: '240 fps (esports)' }
  ];

  function detectCapabilities() {
    var caps = { maxFPS: 60, maxWidth: 1920, maxHeight: 1080, supportsHighFPS: false };
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return caps;
      var supported = navigator.mediaDevices.getSupportedConstraints();
      if (supported.frameRate) caps.maxFPS = 240;
      if (supported.width && supported.height) { caps.maxWidth = 5120; caps.maxHeight = 2880; }
      if (supported.facingMode) caps.supportsFacing = true;
      if (navigator.mediaDevices.getDisplayMedia) caps.supportsScreenShare = true;
    } catch (e) {}
    return caps;
  }

  function buildVideoConstraints(preset, facing, caps, targetFPS) {
    var p = QUALITY_PRESETS[preset] || QUALITY_PRESETS[DEFAULT_PRESET];
    var fps = targetFPS || p.fps[0];
    var c = {
      width: { ideal: p.width, max: Math.min(p.width, caps.maxWidth) },
      height: { ideal: p.height, max: Math.min(p.height, caps.maxHeight) },
      frameRate: { ideal: fps, max: Math.min(fps, caps.maxFPS) }
    };
    if (facing) c.facingMode = facing;
    return c;
  }

  function buildScreenConstraints(preset, caps, targetFPS) {
    var p = QUALITY_PRESETS[preset] || QUALITY_PRESETS[DEFAULT_PRESET];
    var fps = targetFPS || p.fps[0];
    return {
      width: { ideal: p.width, max: Math.min(p.width, caps.maxWidth) },
      height: { ideal: p.height, max: Math.min(p.height, caps.maxHeight) },
      frameRate: { ideal: fps, max: Math.min(fps, caps.maxFPS) },
      cursor: 'always'
    };
  }

  function mediaError(e, isVideo) {
    if (typeof window.NCVoice !== 'undefined' && window.NCVoice.errText) {
      try { return window.NCVoice.errText(e); } catch (x) {}
    }
    var n = (e && (e.name || e.code)) || '';
    if (n === 'NotAllowedError') return isVideo ? 'Camera access denied.' : 'Microphone access denied.';
    if (n === 'NotFoundError') return isVideo ? 'No camera found.' : 'No microphone found.';
    if (n === 'OverconstrainedError') return 'Camera settings not supported. Try a lower quality preset.';
    return isVideo ? 'Could not access the camera.' : 'Could not access the microphone.';
  }

  function createCore(opts) {
    opts = opts || {};
    var me = opts.me, peerId = opts.peerId, conversationId = opts.conversationId;
    var transport = opts.transport, api = opts.api;
    var RTCPC = opts.RTCPeerConnection || ((typeof RTCPeerConnection !== 'undefined') ? RTCPeerConnection : null);
    var GUM = opts.getUserMedia || ((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? function (c) { return navigator.mediaDevices.getUserMedia(c); } : null);
    var ICE = opts.iceServers || DEFAULT_ICE;
    var timeouts = opts.timeouts || {};
    var RING_MS = timeouts.ring != null ? timeouts.ring : 45000;
    var RECONNECT_MS = timeouts.reconnect != null ? timeouts.reconnect : 10000;
    var RECONNECT_GRACE_MS = timeouts.reconnectGrace != null ? timeouts.reconnectGrace : 5000;
    var HEARTBEAT_MS = timeouts.heartbeat != null ? timeouts.heartbeat : 10000;
    var later = opts.setTimeout || setTimeout;
    var clearLater = opts.clearTimeout || clearTimeout;
    var startInterval = opts.setInterval || setInterval;
    var stopInterval = opts.clearInterval || clearInterval;
    var cb = opts.onState || function () {};
    var ticket = opts.ticket || null;
    var afterMic = opts.afterMic || null;
    var releaseMic = opts.releaseMic || null;

    var caps = detectCapabilities();
    var qualityPreset = opts.quality || DEFAULT_PRESET;
    var targetFPS = opts.fps || null;

    var call = {
      id: opts.callId || null, dir: opts.dir || 'out',
      state: 'idle', muted: false, reason: null,
      startedAt: 0, connectedAt: 0,
      video: !!opts.video, videoOn: false, remoteVideo: false, facing: 'user',
      pc: null, stream: null, rawStream: null, camStream: null, videoTrack: null,
      verified: false, iceBuffer: [], timers: {}, heartbeat: null, ended: false,
      quality: qualityPreset, targetFPS: targetFPS,
      stats: { fps: 0, width: 0, height: 0, bitrate: 0, packetsLost: 0, rtt: 0 },
      statsTimer: null,
      screenShare: false, screenStream: null, screenTrack: null, prevVideoTrack: null
    };

    function setState(s, extra) {
      call.state = s;
      if (extra) call.reason = extra;
      if (s === 'connecting' || s === 'connected' || s === 'reconnecting') startHeartbeat();
      if (s === 'ended') { stopHeartbeat(); stopStats(); }
      try { cb(call.state, call); } catch (e) {}
    }
    function later_(name, ms, fn) {
      clearLater_(name);
      call.timers[name] = later(fn, ms);
    }
    function clearLater_(name) {
      if (call.timers[name]) { try { clearLater(call.timers[name]); } catch (e) {} call.timers[name] = null; }
    }
    function clearTimers() { Object.keys(call.timers).forEach(clearLater_); }
    function send(msg) {
      msg.callId = call.id;
      msg.from = me.id;
      return transport.send(peerId, msg);
    }
    function apiCall(path, body) {
      return api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    }
    function applyMic(stream) {
      if (!afterMic) return Promise.resolve(stream);
      return Promise.resolve().then(function () { return afterMic(stream); })
        .then(function (s) { return s || stream; }, function () { return stream; });
    }
    function beginMicEnhance(rawStream) {
      if (!afterMic) return;
      applyMic(rawStream).then(function (finalStream) {
        if (call.ended) { stopStream(finalStream); return; }
        if (!finalStream || finalStream === rawStream) return;
        var at = null;
        try { at = finalStream.getAudioTracks()[0]; } catch (e) {}
        if (at && call.pc) {
          try {
            call.pc.getSenders().forEach(function (sn) {
              try { if (sn.track && sn.track.kind === 'audio') sn.replaceTrack(at); } catch (e) {}
            });
          } catch (e) {}
        }
        call.stream = finalStream;
        try { cb(call.state, call); } catch (e) {}
      });
    }
    function mediaConstraints() {
      var c = { audio: micConstraints() };
      if (call.video) c.video = buildVideoConstraints(call.quality, call.facing, caps);
      return c;
    }
    function negotiate() {
      if (!call.pc) return Promise.resolve();
      return call.pc.createOffer().then(function (offer) {
        return call.pc.setLocalDescription(offer).then(function () {
          return send({ t: 'offer', renegotiate: true, sdp: offer }).catch(function () {});
        });
      });
    }
    function broadcastMedia() {
      return send({ t: 'media', video: !!call.videoOn, audio: !call.muted, quality: call.quality, fps: call.targetFPS, screenShare: !!call.screenShare }).catch(function () {});
    }
    function setupPc(stream) {
      if (!RTCPC) throw new Error('WebRTC not supported in this browser.');
      var pc = new RTCPC({ iceServers: ICE });
      call.pc = pc;
      try {
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
      } catch (e) {}
      pc.onicecandidate = function (ev) {
        if (ev.candidate) send({ t: 'ice', candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }).catch(function () {});
      };
      pc.ontrack = function (ev) {
        var kind = (ev.track && ev.track.kind) || 'audio';
        if (kind === 'video') call.remoteVideo = true;
        try { cb('remote-track', call, ev.streams && ev.streams[0], kind); } catch (e) {}
      };
      pc.onconnectionstatechange = function () {
        var s = 'unknown';
        try { s = pc.connectionState; } catch (e) {}
        if (s === 'connected') {
          clearLater_('reconnect-grace');
          clearLater_('reconnect');
          if (call.state !== 'connected') {
            call.connectedAt = call.connectedAt || Date.now();
            setState('connected');
            startStats();
          }
        } else if (s === 'disconnected') {
          if (call.state === 'connected' || call.state === 'reconnecting') {
            clearLater_('reconnect-grace');
            later_('reconnect-grace', RECONNECT_GRACE_MS, function () {
              var cs = 'unknown';
              try { cs = pc.connectionState; } catch (e) {}
              if (cs !== 'connected' && !call.ended) {
                setState('reconnecting');
                later_('reconnect', RECONNECT_MS, function () { finish('failed', true); });
              }
            });
          }
        } else if (s === 'failed') {
          finish('failed', true);
        }
      };
      return pc;
    }
    function stopStream(s) { if (s) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} } }
    function stopTracks() {
      if (call.stream && releaseMic) { try { releaseMic(call.stream); } catch (e) {} }
      stopStream(call.stream);
      stopStream(call.camStream);
      stopStream(call.rawStream);
      call.stream = null; call.camStream = null; call.videoTrack = null;
    }
    function closePc() {
      if (call.pc) { try { call.pc.onicecandidate = null; call.pc.ontrack = null; call.pc.onconnectionstatechange = null; call.pc.close(); } catch (e) {} call.pc = null; }
    }
    function serverEnd() {
      if (!call.id) return Promise.resolve();
      return apiCall('/api/calls/' + call.id + '/end', {}).catch(function () {});
    }
    function stopHeartbeat() {
      if (call.heartbeat) { try { stopInterval(call.heartbeat); } catch (e) {} call.heartbeat = null; }
    }
    function startHeartbeat() {
      if (call.heartbeat || call.ended || !call.id) return;
      var tick = function () {
        if (call.ended || !call.id) { stopHeartbeat(); return; }
        apiCall('/api/calls/' + call.id + '/ping', {}).catch(function () {});
      };
      tick();
      call.heartbeat = startInterval(tick, HEARTBEAT_MS);
    }
    function stopStats() {
      if (call.statsTimer) { clearInterval(call.statsTimer); call.statsTimer = null; }
    }
    function startStats() {
      stopStats();
      var lastOutBytes = 0, lastInBytes = 0, lastTime = Date.now();
      call.statsTimer = startInterval(function () {
        if (call.ended || !call.pc) { stopStats(); return; }
        call.pc.getStats().then(function (report) {
          var now = Date.now();
          var dt = (now - lastTime) / 1000;
          var videoStats = { 
            outbound: { fps: 0, width: 0, height: 0, bitrate: 0, packetsLost: 0 },
            inbound: { fps: 0, width: 0, height: 0, bitrate: 0, packetsLost: 0 },
            rtt: 0
          };
          report.forEach(function (s) {
            if (s.type === 'outbound-rtp' && s.kind === 'video') {
              videoStats.outbound.width = s.frameWidth || 0;
              videoStats.outbound.height = s.frameHeight || 0;
              videoStats.outbound.fps = s.framesPerSecond || 0;
              if (s.bytesSent && dt > 0) videoStats.outbound.bitrate = Math.round((s.bytesSent - lastOutBytes) * 8 / dt);
              videoStats.outbound.packetsLost = s.packetsLost || 0;
            }
            if (s.type === 'inbound-rtp' && s.kind === 'video') {
              videoStats.inbound.width = s.frameWidth || 0;
              videoStats.inbound.height = s.frameHeight || 0;
              videoStats.inbound.fps = s.framesPerSecond || 0;
              if (s.bytesReceived && dt > 0) videoStats.inbound.bitrate = Math.round((s.bytesReceived - lastInBytes) * 8 / dt);
              videoStats.inbound.packetsLost = s.packetsLost || 0;
            }
            if (s.type === 'candidate-pair' && s.current === true) {
              videoStats.rtt = Math.round((s.currentRoundTripTime || 0) * 1000);
            }
          });
          lastOutBytes = 0; lastInBytes = 0;
          report.forEach(function (s) {
            if (s.type === 'outbound-rtp' && s.kind === 'video') lastOutBytes = s.bytesSent || 0;
            if (s.type === 'inbound-rtp' && s.kind === 'video') lastInBytes = s.bytesReceived || 0;
          });
          lastTime = now;
          call.stats = videoStats;
          try { cb('stats', call, videoStats); } catch (e) {}
        }).catch(function () {});
      }, 1000);
    }
    function applyQuality(newPreset, newFPS) {
      if (call.ended || !call.video) return Promise.resolve();
      var nextPreset = newPreset || call.quality;
      var nextFPS = newFPS !== undefined ? newFPS : call.targetFPS;
      if (nextPreset === call.quality && nextFPS === call.targetFPS) return Promise.resolve();
      call.quality = nextPreset;
      call.targetFPS = nextFPS;
      if (!call.videoTrack || !call.pc) return Promise.resolve();
      var sender = null;
      try {
        sender = call.pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
      } catch (e) {}
      if (!sender) return Promise.resolve();
      var constraints = buildVideoConstraints(nextPreset, call.facing, caps);
      if (nextFPS) constraints.frameRate = { ideal: nextFPS, max: Math.min(nextFPS, caps.maxFPS) };
      var bitrate = call.screenShare && QUALITY_PRESETS[nextPreset].screenBitrate
        ? QUALITY_PRESETS[nextPreset].screenBitrate
        : QUALITY_PRESETS[nextPreset].maxBitrate;
      return sender.getParameters().then(function (params) {
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0] = params.encodings[0] || {};
        params.encodings[0].maxBitrate = bitrate;
        params.encodings[0].maxFramerate = constraints.frameRate.max;
        return sender.setParameters(params);
      }).catch(function () {
        return call.videoTrack.applyConstraints(constraints).then(function () {
          return negotiate();
        }).catch(function (e) {
          if (e && e.name === 'OverconstrainedError') {
            var fallback = PRESET_ORDER[PRESET_ORDER.indexOf(nextPreset) + 1];
            if (fallback) return applyQuality(fallback, nextFPS);
          }
          throw e;
        });
      });
    }
    function setQuality(preset) {
      if (!QUALITY_PRESETS[preset]) return Promise.reject(new Error('Invalid quality preset'));
      return applyQuality(preset, call.targetFPS);
    }
    function setFPS(fps) {
      if (typeof fps !== 'number' || fps < 1 || fps > 240) return Promise.reject(new Error('Invalid FPS'));
      return applyQuality(call.quality, fps);
    }
    function getQuality() {
      return {
        preset: call.quality,
        targetFPS: call.targetFPS,
        actual: call.stats,
        capabilities: caps,
        presets: PRESET_ORDER.map(function (k) { return { key: k, label: QUALITY_PRESETS[k].label }; }),
        fpsPresets: FPS_PRESETS
      };
    }

    function finish(reason, remote) {
      if (call.ended) return;
      call.ended = true;
      clearTimers();
      stopHeartbeat();
      stopStats();
      closePc();
      stopTracks();
      if (!remote) {
        try { send({ t: 'end', reason: reason || 'ended' }).catch(function () {}); } catch (e) {}
      }
      serverEnd();
      setState('ended', reason || 'ended');
    }
    function applyRemoteIce(c) {
      if (!c) return;
      var pc = call.pc;
      if (!pc || !pc.remoteDescription) {
        if (call.iceBuffer.length < 100) call.iceBuffer.push(c);
        return;
      }
      try {
        var cand = (typeof RTCIceCandidate !== 'undefined' && c.candidate) ? new RTCIceCandidate(c) : c;
        pc.addIceCandidate(cand).catch(function () {});
      } catch (e) {}
    }
    function flushIce() {
      var buf = call.iceBuffer;
      call.iceBuffer = [];
      buf.forEach(applyRemoteIce);
    }

    function start() {
      if (call.state !== 'idle' || call.ended) return Promise.resolve();
      setState('calling');
      return apiCall('/api/calls/invite', { conversationId: conversationId, video: !!call.video }).then(function (d) {
        if (!d || !d.call || !d.ticket) throw new Error((d && d.error) || 'Could not start the call.');
        call.id = d.call.id;
        ticket = d.ticket;
        if (!GUM) throw new Error('Calling is not supported in this browser.');
        return GUM(mediaConstraints());
      }).then(function (stream) {
        if (call.ended) { stopStream(stream); return; }
        call.rawStream = stream;
        call.stream = stream;
        try { call.videoOn = !!(stream.getVideoTracks && stream.getVideoTracks().length); } catch (e) {}
        var pc = setupPc(stream);
        beginMicEnhance(stream);
        return pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer).then(function () {
            return send({ t: 'offer', sdp: offer, ticket: ticket, conv: conversationId, video: !!call.video, quality: call.quality, fps: call.targetFPS }).then(function () {
              setState('ringing');
              later_('ring', RING_MS, function () { finish('no-answer'); });
            });
          });
        });
      }).catch(function (e) {
        var msg = (e && e.message) || 'Call failed.';
        if (/already in (a|another) call/i.test(msg)) return finish('busy', true);
        if (/offline/i.test(msg)) return finish('offline', true);
        if (/not supported|microphone|camera|denied|NotAllowed|NotFound|NotReadable|Overconstrained/i.test(msg)) {
          serverEnd();
          return finish(mediaError(e, !!call.video), true);
        }
        serverEnd();
        return finish(msg, true);
      });
    }

    function incoming(offerMsg, verifiedCall) {
      call.id = offerMsg.callId;
      ticket = offerMsg.ticket || null;
      call.video = !!offerMsg.video;
      call.quality = offerMsg.quality || DEFAULT_PRESET;
      call.targetFPS = offerMsg.fps || null;
      setState('ringing');
      later_('ring', RING_MS, function () { finish('missed'); });
      call._offer = offerMsg;
      call._verifiedCall = verifiedCall || null;
    }
    function accept() {
      if (call.dir !== 'in' || call.state !== 'ringing' || call.ended) return Promise.resolve();
      clearLater_('ring');
      setState('connecting');
      return apiCall('/api/calls/' + call.id + '/accept', {}).then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || 'Could not answer.');
        if (!GUM) throw new Error('Calling is not supported in this browser.');
        return GUM(mediaConstraints());
      }).then(function (stream) {
        if (call.ended) { stopStream(stream); return; }
        call.rawStream = stream;
        call.stream = stream;
        try { call.videoOn = !!(stream.getVideoTracks && stream.getVideoTracks().length); } catch (e) {}
        call.verified = true;
        var pc = setupPc(stream);
        beginMicEnhance(stream);
        return pc.setRemoteDescription(call._offer.sdp).then(function () {
          flushIce();
          return pc.createAnswer().then(function (answer) {
            return pc.setLocalDescription(answer).then(function () {
              broadcastMedia();
              return send({ t: 'answer', sdp: answer, ticket: ticket }).catch(function () {});
            });
          });
        });
      }).catch(function (e) {
        var msg = (e && e.message) || 'Could not answer.';
        if (/another call|ringing/i.test(msg)) return finish('busy', true);
        if (/microphone|camera|denied|NotAllowed|NotFound|not supported|NotReadable|Overconstrained/i.test(msg)) {
          try { send({ t: 'decline' }).catch(function () {}); } catch (x) {}
          serverEnd();
          return finish(mediaError(e, !!call.video), true);
        }
        serverEnd();
        return finish(msg, true);
      });
    }
    function decline() {
      if (call.ended) return;
      try { send({ t: 'decline' }).catch(function () {}); } catch (e) {}
      finish('declined-local');
    }
    function cancel() {
      if (call.ended) return;
      try { send({ t: 'cancel' }).catch(function () {}); } catch (e) {}
      finish('cancelled-local');
    }
    function end() { finish('ended-local'); }
    function toggleMute() {
      call.muted = !call.muted;
      try {
        if (call.stream) call.stream.getAudioTracks().forEach(function (t) { t.enabled = !call.muted; });
      } catch (e) {}
      broadcastMedia();
      try { cb(call.state, call); } catch (e2) {}
      return call.muted;
    }
    function hasVideoTrack() {
      try { return !!(call.stream && call.stream.getVideoTracks().length); } catch (e) { return false; }
    }
    function setVideo(on) {
      if (call.ended) return Promise.resolve(call.videoOn);
      on = !!on;
      if (!on || hasVideoTrack()) {
        call.videoOn = on;
        try { if (call.stream) call.stream.getVideoTracks().forEach(function (t) { t.enabled = on; }); } catch (e) {}
        broadcastMedia();
        try { cb(call.state, call); } catch (e) {}
        return Promise.resolve(on);
      }
      if (!GUM) return Promise.reject(new Error('Camera not available.'));
      return GUM({ video: buildVideoConstraints(call.quality, call.facing, caps) }).then(function (s) {
        var vt = s.getVideoTracks()[0];
        if (!vt) throw new Error('No camera found.');
        call.camStream = s;
        call.videoTrack = vt;
        try { call.stream.addTrack(vt); } catch (e) {}
        try { call.pc.addTrack(vt, call.stream); } catch (e) {}
        call.videoOn = true;
        broadcastMedia();
        return negotiate().then(function () { try { cb(call.state, call); } catch (e) {} return true; });
      });
    }
    function toggleVideo() {
      return setVideo(!call.videoOn).catch(function (e) {
        try { cb('media-error', call, e); } catch (x) {}
        return call.videoOn;
      });
    }
    function switchCamera() {
      if (!call.videoTrack) return Promise.resolve();
      call.facing = call.facing === 'user' ? 'environment' : 'user';
      try { return Promise.resolve(call.videoTrack.applyConstraints({ facingMode: call.facing })).catch(function () {}); }
      catch (e) { return Promise.resolve(); }
    }

    function screenShareError(e) {
      if (typeof window.NCVoice !== 'undefined' && window.NCVoice.errText) {
        try { return window.NCVoice.errText(e); } catch (x) {}
      }
      var n = (e && (e.name || e.code)) || '';
      if (n === 'NotAllowedError') return 'Screen sharing permission denied.';
      if (n === 'NotFoundError') return 'No screen source selected.';
      if (n === 'OverconstrainedError') return 'Screen share settings not supported.';
      if (n === 'NotSupportedError') return 'Screen sharing not supported in this browser.';
      return 'Could not start screen sharing.';
    }

    function startScreenShare() {
      if (call.ended || !call.pc || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return Promise.reject(new Error('Screen sharing not supported.'));
      }
      if (call.screenShare) return Promise.resolve();
      return navigator.mediaDevices.getDisplayMedia({
        video: buildScreenConstraints(call.quality, caps, call.targetFPS),
        audio: false
      }).then(function (screenStream) {
        if (call.ended || !call.pc) {
          screenStream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        var screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) {
          screenStream.getTracks().forEach(function (t) { t.stop(); });
          throw new Error('No video track in screen share stream.');
        }
        call.screenStream = screenStream;
        call.screenTrack = screenTrack;
        call.prevVideoTrack = call.videoTrack || null;
        var sender = call.pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
        if (sender) {
          return sender.replaceTrack(screenTrack).then(function () {
            if (call.stream) {
              try { call.stream.removeTrack(call.videoTrack); } catch (e) {}
              try { call.stream.addTrack(screenTrack); } catch (e) {}
            }
            call.screenShare = true;
            call.videoOn = true;
            broadcastMedia();
            try { cb('screen-share-start', call); } catch (e) {}
            screenTrack.onended = function () { stopScreenShare(); };
            return negotiate();
          });
        } else {
          call.pc.addTrack(screenTrack, call.stream);
          if (call.stream) {
            try { call.stream.removeTrack(call.videoTrack); } catch (e) {}
            try { call.stream.addTrack(screenTrack); } catch (e) {}
          }
          call.screenShare = true;
          call.videoOn = true;
          broadcastMedia();
          try { cb('screen-share-start', call); } catch (e) {}
          screenTrack.onended = function () { stopScreenShare(); };
          return negotiate();
        }
      }).catch(function (e) {
        call.screenStream = null;
        call.screenTrack = null;
        call.prevVideoTrack = null;
        throw e;
      });
    }

    function stopScreenShare() {
      if (!call.screenShare || !call.screenStream) return Promise.resolve();
      return new Promise(function (resolve) {
        try {
          call.screenStream.getTracks().forEach(function (t) { t.stop(); });
        } catch (e) {}
        call.screenStream = null;
        call.screenTrack = null;
        call.screenShare = false;
        var sender = call.pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
        if (call.prevVideoTrack && sender) {
          sender.replaceTrack(call.prevVideoTrack).then(function () {
            if (call.stream) {
              try { call.stream.removeTrack(call.screenTrack); } catch (e) {}
              try { call.stream.addTrack(call.prevVideoTrack); } catch (e) {}
            }
            call.videoOn = true;
            call.prevVideoTrack = null;
            broadcastMedia();
            try { cb('screen-share-stop', call); } catch (e) {}
            return negotiate().then(function () { resolve(); }).catch(function () { resolve(); });
          }).catch(function () { resolve(); });
        } else if (call.videoTrack && sender) {
          sender.replaceTrack(call.videoTrack).then(function () {
            if (call.stream) {
              try { call.stream.addTrack(call.videoTrack); } catch (e) {}
            }
            call.videoOn = true;
            broadcastMedia();
            try { cb('screen-share-stop', call); } catch (e) {}
            return negotiate().then(function () { resolve(); }).catch(function () { resolve(); });
          }).catch(function () { resolve(); });
        } else {
          call.videoOn = false;
          broadcastMedia();
          try { cb('screen-share-stop', call); } catch (e) {}
          resolve();
        }
      });
    }

    function toggleScreenShare() {
      if (call.screenShare) return stopScreenShare();
      return startScreenShare();
    }

    function onSignal(m) {
      if (call.ended || !m || m.callId !== call.id) return Promise.resolve();
      if (m.t === 'answer' && call.dir === 'out' && call.state === 'ringing') {
        clearLater_('ring');
        setState('connecting');
        return apiCall('/api/calls/verify', { ticket: m.ticket }).then(function (d) {
          if (!d || !d.call) throw new Error('unverified answer');
          call.verified = true;
          return call.pc.setRemoteDescription(m.sdp);
        }).then(function () { flushIce(); }).catch(function () { finish('failed', true); });
      }
      if (m.t === 'ice') { applyRemoteIce(m.candidate); return Promise.resolve(); }
      if (m.t === 'media') {
        call.remoteVideo = m.video !== false;
        call.remoteScreenShare = !!m.screenShare;
        try { cb('remote-media', call); } catch (e) {}
        return Promise.resolve();
      }
      if (m.t === 'offer' && m.renegotiate && call.pc) {
        return call.pc.setRemoteDescription(m.sdp).then(function () {
          return call.pc.createAnswer();
        }).then(function (ans) {
          return call.pc.setLocalDescription(ans).then(function () {
            return send({ t: 'answer', renegotiate: true, sdp: ans }).catch(function () {});
          });
        }).catch(function () {});
      }
      if (m.t === 'answer' && m.renegotiate && call.pc) {
        return call.pc.setRemoteDescription(m.sdp).catch(function () {});
      }
      if (m.t === 'decline') { finish(call.dir === 'out' ? 'declined' : 'ended', true); return Promise.resolve(); }
      if (m.t === 'busy') { finish('busy', true); return Promise.resolve(); }
      if (m.t === 'cancel' || m.t === 'end') { finish(m.t === 'cancel' ? 'cancelled' : 'ended', true); return Promise.resolve(); }
      return Promise.resolve();
    }

    return {
      call: call,
      start: start, incoming: incoming, accept: accept, decline: decline,
      cancel: cancel, end: end, toggleMute: toggleMute,
      toggleVideo: toggleVideo, setVideo: setVideo, switchCamera: switchCamera,
      startScreenShare: startScreenShare, stopScreenShare: stopScreenShare, toggleScreenShare: toggleScreenShare,
      setQuality: setQuality, setFPS: setFPS, getQuality: getQuality,
      onSignal: onSignal
    };
  }

  window.NCCallCore = {
    create: createCore,
    isCallSignal: isCallSignal,
    fmtDur: fmtDur,
    micConstraints: micConstraints,
    videoConstraints: function (facing) { return buildVideoConstraints(DEFAULT_PRESET, facing, detectCapabilities()); },
    QUALITY_PRESETS: QUALITY_PRESETS,
    PRESET_ORDER: PRESET_ORDER
  };
})();