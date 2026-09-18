/* Voice enhancement: AI noise suppression via vendored RNNoise WASM.
 * Pipeline: decode -> mono 48kHz -> RNNoise (960-sample pipeline latency
 * compensated, tail flushed) -> peak-normalize -> 16kHz 16-bit WAV.
 * Any failure throws -> caller falls back to the original recording. */
(function () {
  if (window.NCVoiceEnhance) return;

  var RN_LATENCY = 960;
  var RN_RATE = 48000;
  var OUT_RATE = 16000;
  var FRAME = 480;
  var libPromise = null;

  function supported() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (typeof WebAssembly !== 'object') return false;
      if (typeof OfflineAudioContext === 'undefined' && typeof window.OfflineAudioContext === 'undefined') return false;
      return true;
    } catch (e) { return false; }
  }

  function loadLib() {
    if (!libPromise) {
      libPromise = import('/rnnoise-lib.js?v=1')
        .then(function (m) { return m.Rnnoise.load(); })
        .catch(function (e) { libPromise = null; throw e; });
    }
    return libPromise;
  }

  function decodeToMono48(arrayBuf, onProgress) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    return ctx.decodeAudioData(arrayBuf.slice(0)).then(function (buf) {
      var ch0 = buf.getChannelData(0);
      var mono;
      if (buf.numberOfChannels > 1) {
        mono = new Float32Array(buf.length);
        for (var c = 0; c < buf.numberOfChannels; c++) {
          var ch = buf.getChannelData(c);
          for (var i = 0; i < buf.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
        }
      } else {
        mono = new Float32Array(ch0);
      }
      try { if (ctx.close) ctx.close(); } catch (e) {}
      if (buf.sampleRate === RN_RATE) {
        if (onProgress) onProgress(0.08, 'Enhancing voice…');
        return mono;
      }
      var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var len = Math.max(1, Math.ceil(mono.length * RN_RATE / buf.sampleRate));
      var oc = new OC(1, len, RN_RATE);
      var src = oc.createBuffer(1, mono.length, buf.sampleRate);
      src.getChannelData(0).set(mono);
      var player = oc.createBufferSource();
      player.buffer = src;
      player.connect(oc.destination);
      player.start(0);
      return oc.startRendering().then(function (rb) {
        if (onProgress) onProgress(0.12, 'Enhancing voice…');
        return new Float32Array(rb.getChannelData(0));
      });
    }).catch(function (e) {
      try { if (ctx && ctx.close) ctx.close(); } catch (x) {}
      throw e;
    });
  }

  function encodeWav16(pcm, sampleRate) {
    var n = pcm.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    var wstr = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, 'data');
    v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, Math.round(s * 32767), true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function enhanceAudio(blob, onProgress, signal) {
    var prog = function (f, label) { try { if (onProgress) onProgress(f, label || 'Enhancing voice…'); } catch (e) {} };
    var alive = function () { return !(signal && signal.cancelled); };
    if (!supported()) return Promise.reject(new Error('enhancement not supported'));
    prog(0.02, 'Preparing audio…');
    return blob.arrayBuffer().then(function (ab) {
      if (!alive()) throw { aborted: true };
      return decodeToMono48(ab, prog);
    }).then(function (pcm48) {
      if (!alive()) throw { aborted: true };
      if (!pcm48 || pcm48.length < FRAME) throw new Error('recording too short');
      return loadLib().then(function (rn) {
        var st = rn.createDenoiseState();
        var N = pcm48.length;
          var padded = Math.ceil((N + RN_LATENCY) / FRAME) * FRAME;
          var out = new Float32Array(padded);
          var frame = new Float32Array(FRAME);
          var total = Math.ceil(padded / FRAME);
          var oi = 0;
          return new Promise(function (resolve, reject) {
            var run = function () {
              if (!alive()) { reject({ aborted: true }); return; }
              try {
                var batch = Math.min(48, total - oi);
                for (var b = 0; b < batch; b++, oi++) {
                  var o = oi * FRAME;
                  for (var i = 0; i < FRAME; i++) {
                    var idx = o + i;
                    var x = idx < N ? pcm48[idx] * 32768 : 0;
                    frame[i] = x > 32767 ? 32767 : (x < -32768 ? -32768 : x);
                  }
                  st.processFrame(frame);
                  out.set(frame, o);
                }
                prog(0.12 + 0.76 * (oi / total), 'Enhancing voice…');
                if (oi < total) { setTimeout(run, 0); return; }
                resolve();
              } catch (e) { reject(e); }
            };
            run();
          }).then(function () {
            try {
              var clean = new Float32Array(N);
              for (var i = 0; i < N; i++) clean[i] = Math.max(-1, Math.min(1, out[RN_LATENCY + i] / 32768));
              var peak = 0;
              for (var j = 0; j < N; j++) { var a = Math.abs(clean[j]); if (a > peak) peak = a; }
              if (peak > 0) {
                var g = Math.min(3, 0.98 / peak);
                if (g !== 1) for (var k = 0; k < N; k++) clean[k] *= g;
              }
              prog(0.9, 'Encoding…');
              var down = new Float32Array(Math.ceil(N / 3));
              for (var m = 0; m < down.length; m++) {
                var s0 = m * 3;
                down[m] = ((clean[s0] || 0) + (clean[s0 + 1] || 0) + (clean[s0 + 2] || 0)) / 3;
              }
              prog(1, 'Done');
              return { blob: encodeWav16(down, OUT_RATE), sampleRate: OUT_RATE };
            } finally {
              try { st.destroy(); } catch (e) {}
            }
          }, function (e) { try { st.destroy(); } catch (x) {} throw e; });
      });
    });
  }

  window.NCVoiceEnhance = { enhance: enhanceAudio, supported: supported, RN_LATENCY: RN_LATENCY };
})();
