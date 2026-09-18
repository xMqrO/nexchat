/* Realtime call-signaling transport over Supabase Realtime broadcast.
 * Vendored realtime-js + phoenix (MIT) under /vendor — no runtime CDN.
 * Thin pipe: connect/send/disconnect. Protocol semantics live in call.js. */
(function () {
  if (window.NCCallSignal) return;

  var RT_URL = '/vendor/realtime.mjs?v=1';
  var modPromise = null;
  var client = null;
  var ownChannel = null;
  var sendChannels = {};
  var myId = null;
  var handler = null;

  function defaultClientClass() {
    if (!modPromise) {
      modPromise = import(RT_URL).then(
        function (m) {
          if (!m || !m.RealtimeClient) throw new Error('realtime lib missing');
          return m.RealtimeClient;
        },
        function (e) { modPromise = null; throw e; }
      );
    }
    return modPromise;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error(label || 'timed out')); }, ms); })
    ]);
  }

  function join(ch) {
    return withTimeout(new Promise(function (resolve, reject) {
      ch.subscribe(function (status, err) {
        if (status === 'SUBSCRIBED') return resolve(ch);
        var detail = (err && (err.message || err.reason || err)) || status;
        try { detail = typeof detail === 'string' ? detail : JSON.stringify(detail); } catch (e) { detail = String(detail); }
        reject(new Error('Realtime subscribe failed: ' + detail));
      });
    }), 15000, 'Realtime subscribe timed out');
  }

  function connect(opts) {
    opts = opts || {};
    if (!opts.url || !opts.anonKey || !opts.userId) return Promise.reject(new Error('signaling misconfigured'));
    if (client) return Promise.resolve(true);
    var clsPromise = opts.createClient
      ? Promise.resolve(opts.createClient)
      : defaultClientClass();
    return withTimeout(clsPromise, 15000, 'Realtime library failed to load').then(function (Cls) {
      var endpoint = String(opts.url).replace(/\/+$/, '') + '/realtime/v1';
      client = new Cls(endpoint, { params: { apikey: opts.anonKey } });
      myId = opts.userId;
      ownChannel = client.channel('calls:' + myId);
      ownChannel.on('broadcast', { event: 'call' }, function (msg) {
        var payload = msg && msg.payload ? msg.payload : msg;
        try { if (handler) handler(payload); } catch (e) {}
      });
      return join(ownChannel).then(function () { return true; });
    }).catch(function (e) {
      try { if (client && client.disconnect) client.disconnect(); } catch (x) {}
      client = null; ownChannel = null; sendChannels = {};
      throw e;
    });
  }

  function sendChannel(peerId) {
    if (sendChannels[peerId]) return Promise.resolve(sendChannels[peerId]);
    var ch = client.channel('calls:' + peerId);
    sendChannels[peerId] = ch;
    return join(ch).catch(function (e) { delete sendChannels[peerId]; throw e; });
  }

  function send(peerId, msg) {
    if (!client || !myId) return Promise.reject(new Error('signaling not connected'));
    if (!peerId || peerId === myId) return Promise.reject(new Error('bad signaling peer'));
    return sendChannel(peerId).then(function (ch) {
      return ch.send({ type: 'broadcast', event: 'call', payload: msg });
    });
  }

  function disconnect() {
    var tasks = [];
    try {
      Object.keys(sendChannels).forEach(function (k) {
        try { tasks.push(client.removeChannel(sendChannels[k]).catch(function () {})); } catch (e) {}
      });
      if (ownChannel) tasks.push(client.removeChannel(ownChannel).catch(function () {}));
    } catch (e) {}
    sendChannels = {};
    ownChannel = null;
    var c = client;
    client = null; myId = null;
    try { if (c && c.disconnect) return Promise.resolve(c.disconnect()).then(function () {}, function () {}); } catch (e) {}
    return Promise.resolve();
  }

  window.NCCallSignal = {
    connect: connect,
    send: send,
    disconnect: disconnect,
    onMessage: function (cb) { handler = cb; },
    isConnected: function () { return !!(client && ownChannel); }
  };
})();
