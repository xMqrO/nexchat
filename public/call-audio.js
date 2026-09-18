/* Real-time call noise isolation using the vendored RNNoise WASM.
 * getUserMedia audio -> ScriptProcessor (48kHz) -> RNNoise per 480-sample
 * frame -> MediaStreamDestination. Video tracks pass through untouched.
 * Any failure resolves to the original stream, so calls never break. */
(function () {
  if (window.NCCallAudio) return;

  var RN_RATE = 48000;
  var FRAME = 480;
  var RING = 8192; /* power of two */
  var libPromise = null;
  var active = new Map();

  function wantIsolation() {
    try { if (typeof prefs === 'function') return prefs().noiseIsolation !== false; } catch (e) {}
    return true;
  }
  function supported() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (typeof WebAssembly !== 'object') return false;
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

  function enhance(stream) {
    if (!stream || !wantIsolation() || !supported()) return Promise.resolve(stream);
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx;
    try { ctx = new AC(); } catch (e) { return Promise.resolve(stream); }
    if (ctx.sampleRate !== RN_RATE) { try { ctx.close(); } catch (e) {} return Promise.resolve(stream); }

    return loadLib().then(function (rn) {
      var src = ctx.createMediaStreamSource(stream);
      var proc = ctx.createScriptProcessor(1024, 1, 1);
      var dest = ctx.createMediaStreamDestination();
      var st = rn.createDenoiseState();
      var buf = new Float32Array(FRAME);
      var ring = new Float32Array(RING);
      var head = 0, tail = 0, count = 0, fill = 0;

      src.connect(proc);
      proc.connect(dest);
      proc.onaudioprocess = function (ev) {
        var inp = ev.inputBuffer.getChannelData(0);
        var out = ev.outputBuffer.getChannelData(0);
        for (var i = 0; i < inp.length; i++) {
          buf[fill++] = inp[i] * 32768;
          if (fill === FRAME) {
            try { st.processFrame(buf); } catch (e) {}
            for (var k = 0; k < FRAME; k++) {
              ring[tail] = buf[k] / 32768;
              tail = (tail + 1) & (RING - 1);
              if (count < RING) count++;
            }
            fill = 0;
          }
        }
        for (var o = 0; o < out.length; o++) {
          if (count > 0) { out[o] = ring[head]; head = (head + 1) & (RING - 1); count--; }
          else out[o] = 0;
        }
      };
      try { if (ctx.resume) ctx.resume(); } catch (e) {}

      var finalStream = new MediaStream();
      var at = dest.stream.getAudioTracks()[0];
      if (at) finalStream.addTrack(at);
      try { stream.getVideoTracks().forEach(function (t) { finalStream.addTrack(t); }); } catch (e) {}

      active.set(finalStream, { ctx: ctx, src: src, proc: proc, st: st, raw: stream });
      return finalStream;
    }).catch(function () { try { ctx.close(); } catch (e) {} return stream; });
  }

  function release(stream) {
    var e = active.get(stream);
    if (!e) return;
    try { e.proc.onaudioprocess = null; } catch (x) {}
    try { e.st.destroy(); } catch (x) {}
    try { e.ctx.close(); } catch (x) {}
    try { e.raw.getTracks().forEach(function (t) { t.stop(); }); } catch (x) {}
    active.delete(stream);
  }

  window.NCCallAudio = { enhance: enhance, release: release, supported: supported, size: function () { return active.size; } };
})();
