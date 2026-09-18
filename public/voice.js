(function () {
  if (window.NCVoice) return;

  var MAX_MS = 5 * 60 * 1000;
  var UPLOAD_TRIES = 3;
  var SPEEDS = [1, 1.5, 2];
  var EXT_BY_MIME = { 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

  var rec = null;      // active recording session
  var preview = null;  // recorded clip awaiting send
  var currentAudio = null;
  var currentBox = null;
  var lastIsoApplied = null;

  /* ---------- pure helpers (unit-tested) ---------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pickMime() {
    var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    try {
      if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function') {
        for (var i = 0; i < cands.length; i++) if (MediaRecorder.isTypeSupported(cands[i])) return cands[i];
      }
    } catch (e) {}
    return '';
  }
  function extFor(mime) {
    var base = String(mime || '').split(';')[0].trim().toLowerCase();
    return EXT_BY_MIME[base] || 'weba';
  }
  function nextSpeed(cur) {
    var i = SPEEDS.indexOf(Number(cur) || 1);
    return SPEEDS[(i + 1) % SPEEDS.length];
  }
  function mediaDuration(a) {
    var d = a && a.duration;
    if (d && isFinite(d)) return d;
    d = a && Number(a._dur);
    return d && isFinite(d) && d > 0 ? d : 0;
  }
  function ensureDuration(a, cb) {
    var settled = false;
    var finish = function (d) {
      if (settled) return;
      settled = true;
      try { a.currentTime = 0; } catch (e) {}
      try { a._dur = d; } catch (e) {}
      cb(d);
    };
    var onMeta = function () {
      try {
        if (a.duration && isFinite(a.duration)) { finish(a.duration); return; }
        a.currentTime = 1e7;
      } catch (e) { finish(NaN); }
    };
    var to = setTimeout(function () { finish(NaN); }, 4000);
    var onSeek = function () { clearTimeout(to); try { a.removeEventListener('seeked', onSeek); } catch (e) {} finish(a.duration); };
    try {
      if (a.readyState >= 1) onMeta();
      else a.addEventListener('loadedmetadata', function h() { try { a.removeEventListener('loadedmetadata', h); } catch (e) {} clearTimeout(to); to = setTimeout(function () { finish(NaN); }, 4000); onMeta(); });
      a.addEventListener('seeked', onSeek);
    } catch (e) { clearTimeout(to); finish(NaN); }
  }
  function errText(e) {
    var n = (e && (e.name || e.code)) || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone access denied. Allow it in your browser settings.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone found on this device.';
    if (n === 'NotReadableError') return 'Microphone is busy in another app.';
    return 'Could not start recording (' + (n || 'unknown error') + ').';
  }
  function audioConstraints() {
    var iso = true;
    try { if (typeof prefs === 'function') iso = prefs().noiseIsolation !== false; } catch (e) {}
    if (!iso) return true;
    return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  }

  /* ---------- element helpers ---------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function bar() { return document.getElementById('voice-bar'); }
  function toastLocal(msg, kind) { if (typeof toast === 'function') toast(msg, kind); }

  function drawPeaks(canvas, peaks, progress) {
    try {
      var ctx = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      var n = Math.max(peaks.length, 1);
      var bw = Math.max(2, Math.floor(W / 48));
      var gap = 2;
      var count = Math.min(48, n);
      var start = n - count;
      for (var i = 0; i < count; i++) {
        var p = Math.min(1, peaks[start + i] || 0.02);
        var h = Math.max(2, Math.round(p * (H - 4)));
        var x = i * (bw + gap);
        var played = progress != null && (start + i) / n <= progress;
        ctx.fillStyle = played ? '#8b7cf6' : 'rgba(139,124,246,.38)';
        var y = Math.round((H - h) / 2);
        ctx.fillRect(x, y, bw, h);
      }
    } catch (e) {}
  }

  /* ---------- recording ---------- */
  function cleanupStream() {
    if (rec && rec.stream) { try { rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
  }
  function resetBar() {
    var b = bar();
    if (b) { b.innerHTML = ''; b.classList.add('hidden'); }
    if (typeof cancelAnimationFrame === 'function' && rec && rec.raf) cancelAnimationFrame(rec.raf);
    if (rec && rec.timer) clearInterval(rec.timer);
    cleanupStream();
    rec = null;
  }

  function startRecording() {
    if (rec) { stopRecording(); return; }
    if (preview) { toastLocal('Send or delete the current recording first.'); return; }
    if (typeof active === 'undefined' || !active) { toastLocal('Open a conversation first.', 'error'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toastLocal('Recording needs a secure context (HTTPS or localhost).', 'error');
      return;
    }
    if (typeof window.MediaRecorder === 'undefined') { toastLocal('Voice recording is not supported in this browser.', 'error'); return; }
    var b = bar();
    if (!b) return;
    var wantIso = audioConstraints();
    b.classList.remove('hidden');
    b.innerHTML = '';
    var wrap = el('div', 'voice-rec');
    wrap.innerHTML = '<span class="voice-dot"></span><span class="voice-timer">0:00</span><span class="voice-iso" title="Noise isolation"></span>';
    var canvas = el('canvas', 'voice-canvas');
    canvas.width = 220; canvas.height = 36;
    var cancelBtn = el('button', 'voice-cancel', '🗑');
    cancelBtn.type = 'button'; cancelBtn.title = 'Delete recording';
    var stopBtn = el('button', 'voice-stop', '⏹');
    stopBtn.type = 'button'; stopBtn.title = 'Stop recording';
    wrap.appendChild(canvas); wrap.appendChild(cancelBtn); wrap.appendChild(stopBtn);
    b.appendChild(wrap);
    var timerEl = wrap.querySelector('.voice-timer');
    cancelBtn.onclick = function () { cancelRecording(); };
    stopBtn.onclick = function () { stopRecording(); };

    navigator.mediaDevices.getUserMedia({ audio: wantIso }).then(function (stream) {
      try {
        var trk = stream.getAudioTracks()[0];
        var st = trk && trk.getSettings ? trk.getSettings() : {};
        lastIsoApplied = !!st.noiseSuppression;
      } catch (e) { lastIsoApplied = null; }
      var isoBadge = wrap.querySelector('.voice-iso');
      if (isoBadge) {
        if (wantIso === true) isoBadge.textContent = '';
        else if (lastIsoApplied) { isoBadge.textContent = '✨'; isoBadge.title = 'Noise isolation active'; }
        else isoBadge.title = 'Noise isolation requested (device support varies)';
      }
      var mime = pickMime();
      var mr;
      try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
      catch (e) { cleanupStream(); b.classList.add('hidden'); toastLocal(errText(e), 'error'); return; }
      var chunks = [];
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      var ctx = null, analyser = null, data = null;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ctx = new AC();
          if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
          var src = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          data = new Uint8Array(analyser.fftSize);
        }
      } catch (e) { analyser = null; }
      rec = { stream: stream, mr: mr, chunks: chunks, startTs: Date.now(), timer: null, raf: 0, analyser: analyser, data: data, peaks: [], canvas: canvas, timerEl: timerEl, mime: mime || 'audio/webm', actx: ctx };
      mr.onstop = function () { finishRecording(); };
      try { mr.start(250); } catch (e) { resetBar(); toastLocal(errText(e), 'error'); return; }
      rec.timer = setInterval(function () {
        var elapsed = Date.now() - rec.startTs;
        timerEl.textContent = fmtTime(elapsed / 1000);
        if (elapsed >= MAX_MS) { toastLocal('Maximum length is 5:00.'); stopRecording(); }
      }, 250);
      var draw = function () {
        if (!rec) return;
        var peak = 0.03;
        if (rec.analyser && rec.data) {
          try {
            rec.analyser.getByteTimeDomainData(rec.data);
            for (var i = 0; i < rec.data.length; i++) {
              var v = Math.abs(rec.data[i] - 128) / 128;
              if (v > peak) peak = v;
            }
          } catch (e) {}
        }
        rec.peaks.push(peak);
        if (rec.peaks.length > 240) rec.peaks.shift();
        drawPeaks(rec.canvas, rec.peaks, null);
        if (typeof requestAnimationFrame === 'function') rec.raf = requestAnimationFrame(draw);
      };
      draw();
    }).catch(function (e) {
      b.classList.add('hidden');
      toastLocal(errText(e), 'error');
    });
  }

  function stopRecording() {
    if (!rec) return;
    try { if (rec.mr.state !== 'inactive') rec.mr.stop(); else finishRecording(); }
    catch (e) { finishRecording(); }
  }

  function finishRecording() {
    if (!rec) return;
    var sess = rec;
    rec = null;
    if (sess.timer) clearInterval(sess.timer);
    if (typeof cancelAnimationFrame === 'function' && sess.raf) cancelAnimationFrame(sess.raf);
    cleanupStream();
    if (sess.actx) { try { sess.actx.close(); } catch (e) {} }
    var type = sess.mime.split(';')[0];
    var blob = new Blob(sess.chunks, { type: type });
    if (!blob.size) { resetBar(); toastLocal('Nothing was recorded.', 'error'); return; }
    showPreview(blob, sess.peaks.slice(), Date.now() - sess.startTs);
  }

  function cancelRecording() {
    try { if (rec && rec.mr.state !== 'inactive') rec.mr.onstop = function () {}; } catch (e) {}
    if (preview) {
      try { if (preview.token) preview.token.cancelled = true; } catch (e) {}
      try { if (preview.origUrl) URL.revokeObjectURL(preview.origUrl); } catch (e) {}
      try { if (preview.enhUrl) URL.revokeObjectURL(preview.enhUrl); } catch (e) {}
    }
    preview = null;
    resetBar();
  }

  /* ---------- preview ---------- */
  function showPreview(blob, peaks, msLen) {
    var b = bar();
    if (!b) return;
    var url;
    try { url = URL.createObjectURL(blob); } catch (e) { toastLocal('Could not preview recording.', 'error'); return; }
    var audio = new Audio();
    audio.src = url;
    audio.preload = 'metadata';
    preview = { origBlob: blob, origUrl: url, enhBlob: null, enhUrl: null, audio: audio, peaks: peaks && peaks.length ? peaks : [0.2], sending: false, msLen: msLen || 0, enhancing: false, token: null };
    b.classList.remove('hidden');
    b.innerHTML = '';
    var wrap = el('div', 'voice-prev');
    var playBtn = el('button', 'voice-pplay', '▶');
    playBtn.type = 'button'; playBtn.title = 'Play preview';
    var canvas = el('canvas', 'voice-canvas');
    canvas.width = 220; canvas.height = 36;
    var timerEl = el('span', 'voice-timer', fmtTime((preview.msLen || 0) / 1000));
    var delBtn = el('button', 'voice-pdel', '🗑');
    delBtn.type = 'button'; delBtn.title = 'Delete recording';
    var sendBtn = el('button', 'voice-send primary', 'Send');
    sendBtn.type = 'button';
    var status = el('span', 'voice-status', '');
    wrap.appendChild(playBtn); wrap.appendChild(canvas); wrap.appendChild(timerEl); wrap.appendChild(status); wrap.appendChild(delBtn); wrap.appendChild(sendBtn);
    b.appendChild(wrap);
    drawPeaks(canvas, preview.peaks, 0);
    ensureDuration(audio, function (d) {
      var dd = (d && isFinite(d)) ? d : (preview.msLen || 0) / 1000;
      if (dd > 0) timerEl.textContent = fmtTime(dd);
    });
    audio.ontimeupdate = function () {
      var d = mediaDuration(audio);
      if (d > 0) drawPeaks(canvas, preview.peaks, audio.currentTime / d);
    };
    audio.onended = function () { playBtn.textContent = '▶'; drawPeaks(canvas, preview.peaks, 0); };
    playBtn.onclick = function () {
      if (!preview) return;
      if (preview.audio.paused) { preview.audio.play().catch(function () {}); playBtn.textContent = '⏸'; }
      else { preview.audio.pause(); playBtn.textContent = '▶'; }
    };
    delBtn.onclick = function () { cancelRecording(); };
    sendBtn.onclick = function () { sendRecording(sendBtn); };
    if (window.NCVoiceEnhance && NCVoiceEnhance.supported()) startEnhance();
  }

  function setAudioSrc(url) {
    if (!preview) return;
    try { preview.audio.pause(); } catch (e) {}
    try { preview.audio.src = url; preview.audio.load(); } catch (e) {}
    var b = bar();
    if (!b) return;
    var pb = b.querySelector('.voice-pplay');
    if (pb) pb.textContent = '▶';
    var cv = b.querySelector('.voice-canvas');
    if (cv) drawPeaks(cv, preview.peaks, 0);
  }
  function startEnhance() {
    if (!preview || !window.NCVoiceEnhance) return;
    var p = preview;
    p.enhancing = true;
    p.token = { cancelled: false };
    var b = bar();
    var status = b ? b.querySelector('.voice-status') : null;
    var sendBtn = b ? b.querySelector('.voice-send') : null;
    if (sendBtn) sendBtn.disabled = true;
    window.NCVoiceEnhance.enhance(p.origBlob, function (f, label) {
      if (status) status.textContent = (label || 'Enhancing voice…') + ' ' + Math.round(f * 100) + '%';
    }, p.token).then(function (out) {
      if (!preview || preview !== p || p.token.cancelled) return;
      var eurl = null;
      try { eurl = URL.createObjectURL(out.blob); } catch (e) { useOriginal(); return; }
      p.enhBlob = out.blob;
      p.enhUrl = eurl;
      p.enhancing = false;
      if (status) status.textContent = '';
      if (sendBtn) sendBtn.disabled = false;
      setAudioSrc(p.enhUrl);
    }).catch(function (e) {
      if (!preview || preview !== p) return;
      if (e && e.aborted) return;
      useOriginal();
    });
  }
  function useOriginal() {
    if (!preview) return;
    preview.enhancing = false;
    setAudioSrc(preview.origUrl);
    var b = bar();
    if (b) {
      var status = b.querySelector('.voice-status');
      if (status) status.textContent = '';
      var sendBtn = b.querySelector('.voice-send');
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function uploadBlob(blob, attempt) {
    var fd = new FormData();
    fd.append('image', blob, 'voice-' + Date.now() + '.' + extFor(blob.type));
    return fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || 'Upload failed');
        return d;
      });
    }).catch(function (e) {
      if (attempt < UPLOAD_TRIES) {
        return new Promise(function (res, rej) {
          setTimeout(function () { uploadBlob(blob, attempt + 1).then(res, rej); }, 700 * attempt);
        });
      }
      throw e;
    });
  }

  function sendRecording(btn) {
    if (!preview || preview.sending) return;
    if (typeof active === 'undefined' || !active) { toastLocal('Open a conversation first.', 'error'); return; }
    if (typeof sendMessage !== 'function') { toastLocal('Messaging unavailable.', 'error'); return; }
    var limit = (typeof UPLOAD_LIMIT === 'number') ? UPLOAD_LIMIT : 25 * 1024 * 1024;
    var blob = preview.enhBlob || preview.origBlob;
    if (!blob || blob.size > limit) { toastLocal('Recording is too large to send.', 'error'); return; }
    preview.sending = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    var clip = preview;
    uploadBlob(blob, 1).then(function (d) {
      if (d.mediaType && d.mediaType !== 'audio') throw new Error('Server did not accept audio.');
      preview = null;
      resetBarKeep();
      try { URL.revokeObjectURL(clip.origUrl); } catch (e) {}
      try { if (clip.enhUrl) URL.revokeObjectURL(clip.enhUrl); } catch (e) {}
      sendMessage(d.url, 'audio');
    }).catch(function (e) {
      preview.sending = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
      toastLocal((e && e.message) || 'Upload failed — tap Send to retry.', 'error');
    });
  }
  function resetBarKeep() {
    var b = bar();
    if (b) { b.innerHTML = ''; b.classList.add('hidden'); }
  }

  /* ---------- bubble player ---------- */
  function boxAudio(box) { return box ? box.querySelector('audio') : null; }
  function setIcon(box, playing) {
    var btn = box ? box.querySelector('.voice-play') : null;
    if (btn) btn.textContent = playing ? '⏸' : '▶';
    if (box) box.classList.toggle('playing', !!playing);
  }
  function bindAudio(box) {
    var a = boxAudio(box);
    if (!a || a.dataset.vbound) return;
    a.dataset.vbound = '1';
    var fill = box.querySelector('.voice-fill');
    var time = box.querySelector('.voice-time');
    ensureDuration(a, function (d) {
      if (d && isFinite(d) && time) time.textContent = fmtTime(d);
    });
    a.addEventListener('timeupdate', function () {
      var d = mediaDuration(a);
      if (d > 0 && fill) fill.style.width = Math.min(100, (a.currentTime / d) * 100) + '%';
      if (d > 0 && time) time.textContent = fmtTime(a.currentTime) + ' / ' + fmtTime(d);
    });
    a.addEventListener('ended', function () {
      setIcon(box, false);
      if (fill) fill.style.width = '0%';
      var dd = mediaDuration(a);
      var d = box.querySelector('.voice-time');
      if (d) d.textContent = fmtTime(dd);
      if (currentAudio === a) { currentAudio = null; currentBox = null; }
    });
    a.addEventListener('error', function () { toastLocal('Could not play this recording.', 'error'); });
  }
  function togglePlay(box) {
    if (!box) return;
    var a = boxAudio(box);
    if (!a) return;
    bindAudio(box);
    if (currentAudio && currentAudio !== a) {
      try { currentAudio.pause(); } catch (e) {}
      setIcon(currentBox, false);
      currentAudio = null; currentBox = null;
    }
    if (a.paused) {
      var pr = null;
      try { pr = a.play(); } catch (e) { toastLocal('Could not play this recording.', 'error'); return; }
      if (pr && pr.catch) pr.catch(function () { toastLocal('Could not play this recording.', 'error'); });
      currentAudio = a; currentBox = box;
      setIcon(box, true);
    } else {
      try { a.pause(); } catch (e) {}
      setIcon(box, false);
      currentAudio = null; currentBox = null;
    }
  }
  function cycleSpeed(box) {
    var a = boxAudio(box);
    if (!a) return;
    bindAudio(box);
    var v = nextSpeed(a.playbackRate);
    try { a.playbackRate = v; } catch (e) {}
    var btn = box.querySelector('.voice-speed');
    if (btn) btn.textContent = String(v).replace(/\.0$/, '') + '×';
  }
  function seek(box, clientX) {
    var a = boxAudio(box);
    var track = box ? box.querySelector('.voice-track') : null;
    if (!a || !track) return;
    bindAudio(box);
    var d = mediaDuration(a);
    if (!(d > 0)) return;
    try {
      var r = track.getBoundingClientRect();
      var ratio = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
      a.currentTime = ratio * d;
    } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var play = t.closest('.voice-play');
    if (play) { togglePlay(play.closest('.voice-msg')); return; }
    var sp = t.closest('.voice-speed');
    if (sp) { cycleSpeed(sp.closest('.voice-msg')); return; }
    var track = t.closest('.voice-track');
    if (track) { seek(track.closest('.voice-msg'), e.clientX); }
  });

  window.NCVoice = {
    start: startRecording, stop: stopRecording, cancel: cancelRecording,
    fmtTime: fmtTime, pickMime: pickMime, extFor: extFor, nextSpeed: nextSpeed, errText: errText, audioConstraints: audioConstraints,
    lastIsolation: function () { return lastIsoApplied; },
    isRecording: function () { return !!rec; },
    hasPreview: function () { return !!preview; }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('mic');
    if (b) b.addEventListener('click', function () { window.NCVoice.start(); });
  });
})();
