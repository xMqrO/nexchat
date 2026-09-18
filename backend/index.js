'use strict';

const path = require('path');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const BOTS_FILE = path.join(__dirname, 'bots.txt');
const PROXIES_FILE = path.join(__dirname, 'proxies.txt');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  bots: [],              // { id, name, host, port, version, status, spin, sneak, jump, physics, afk, proxy, proxyId, primary, slot }
  proxies: [],           // { id, type, host, port, username, password, status }
  botsPerProxy: 1,
  autoRespawnEnabled: false,
  massChatState: { enabled: false, target: '*', message: '', interval: null },
  antiSpamEnabled: false,
  followState: { active: false, follower: '*', leader: '' },
  primaryBot: null,
  spinTimers: new Map(),
  afkTimers: new Map(),
  jumpTimers: new Map(),
  moveTimers: new Map(),
  flyTimers: new Map(),
};

let wssClients = [];
let logHistory = [];

// ---------------------------------------------------------------------------
// Proxy helpers
// ---------------------------------------------------------------------------

function parseProxy(raw, typeOverride) {
  try {
    let str = String(raw).trim();
    let type = 'socks5';
    const scheme = str.match(/^(https?|socks5|socks4|socks):\/\//);
    if (scheme) {
      type = scheme[1] === 'socks' ? 'socks5' : scheme[1];
      str = str.slice(scheme[0].length);
    }
    if (typeOverride) type = typeOverride;

    let username = '';
    let password = '';
    const atIdx = str.lastIndexOf('@');
    if (atIdx !== -1) {
      const auth = str.slice(0, atIdx);
      str = str.slice(atIdx + 1);
      const colon = auth.indexOf(':');
      if (colon !== -1) { username = auth.slice(0, colon); password = auth.slice(colon + 1); }
      else username = auth;
    }

    const hostPort = str.split(':');
    let host = hostPort[0];
    let port = parseInt(hostPort[1], 10);
    if (!host || !port) return null;

    return {
      id: crypto.randomBytes(6).toString('hex'),
      type,
      host,
      port,
      username,
      password,
      status: 'active',
    };
  } catch (err) {
    log('error', `Proxy parse failed: ${err.message}`);
    return null;
  }
}

function buildProxiesState() {
  return state.proxies.map(p => ({
    id: p.id, type: p.type, host: p.host, port: p.port,
    username: p.username, password: p.password, status: p.status,
  }));
}

function loadProxiesFile() {
  if (!fs.existsSync(PROXIES_FILE)) {
    log('warn', `proxies.txt not found — create it at ${PROXIES_FILE}`);
    return;
  }
  const lines = fs.readFileSync(PROXIES_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  const seen = new Set(state.proxies.map(p => `${p.type}:${p.host}:${p.port}`));
  let added = 0;
  lines.forEach(raw => {
    const p = parseProxy(raw);
    if (p) {
      const key = `${p.type}:${p.host}:${p.port}`;
      if (seen.has(key)) return;
      seen.add(key);
      p.status = 'connecting';
      state.proxies.push(p);
      added++;
    }
  });
  log('success', `Loaded ${added} proxies from proxies.txt (${state.proxies.length} total)`);
  broadcastState();
}

// ---------------------------------------------------------------------------
// Proxy connections (SOCKS4/5 + HTTP/HTTPS CONNECT)
// ---------------------------------------------------------------------------

function socksConnect(proxy, host, port) {
  const type = proxy.type === 'socks4' ? 4 : 5;
  return SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type,
      ...(proxy.username ? { userId: proxy.username, password: proxy.password || '' } : {}),
    },
    command: 'connect',
    destination: { host, port },
    timeout: 8000,
  }).then(info => info.socket);
}

function httpConnect(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let buf = '';
    let finished = false;

    const fail = (err) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(10000, () => fail(new Error('Proxy CONNECT timeout')));
    socket.on('error', fail);

    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      if (finished) return;
      const statusLine = buf.split('\r\n')[0];
      if (!/^HTTP\/1\.[01] 200/i.test(statusLine)) {
        fail(new Error(`Proxy CONNECT failed: ${statusLine}`));
        return;
      }
      finished = true;
      socket.removeListener('data', onData);
      socket.setTimeout(0);
      const leftover = Buffer.from(buf.slice(idx + 4));
      if (leftover.length) socket.unshift(leftover);

      if (proxy.type === 'https') {
        const secure = tls.connect({ socket, servername: proxy.host });
        secure.once('error', fail);
        secure.once('secureConnect', () => resolve(secure));
      } else {
        resolve(socket);
      }
    };
    socket.on('data', onData);

    let req = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nUser-Agent: bot-controller\r\n`;
    if (proxy.username) {
      req += `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}\r\n`;
    }
    req += '\r\n';
    socket.write(req);
  });
}

function createProxyConnection(proxy, host, port) {
  if (!proxy) return null;
  if (proxy.type === 'socks4' || proxy.type === 'socks5' || proxy.type === 'socks') {
    return socksConnect(proxy, host, port);
  }
  if (proxy.type === 'http' || proxy.type === 'https') {
    return httpConnect(proxy, host, port);
  }
  return Promise.reject(new Error(`Unsupported proxy type: ${proxy.type}`));
}

// ---------------------------------------------------------------------------
// Bot management
// ---------------------------------------------------------------------------

function loadBotAccounts() {
  if (!fs.existsSync(BOTS_FILE)) {
    log('warn', `bots.txt not found — create it at ${BOTS_FILE}`);
    return [];
  }
  return fs.readFileSync(BOTS_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function resolveTargets(target) {
  if (target === '*' || target === undefined || target === null) {
    return state.bots;
  }
  return state.bots.filter(b => b.name === target);
}

function getBot(name) {
  return state.bots.find(b => b.name === name);
}

function assignProxy(bot) {
  const usable = state.proxies.filter(p => p.status === 'active');
  if (!usable.length) return null;
  const counts = {};
  usable.forEach(p => { counts[p.id] = 0; });
  state.bots.forEach(b => { if (b.proxyId) counts[b.proxyId] = (counts[b.proxyId] || 0) + 1; });
  const candidates = usable.filter(p => counts[p.id] < state.botsPerProxy);
  const pool = candidates.length ? candidates : usable;
  pool.sort((a, b) => (counts[a.id] - counts[b.id]));
  return pool[0].id;
}

function addBot(name, cfg) {
  if (getBot(name)) {
    log('warn', `Bot "${name}" already exists`);
    return;
  }
  if (!cfg || !cfg.host || !cfg.port) {
    log('error', `Cannot create ${name} — missing server host/port`);
    return;
  }

  const botRecord = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    host: cfg.host,
    port: cfg.port,
    version: cfg.version || '1.8.9',
    status: 'connecting',
    spin: false, sneak: false, jump: false, physics: true, afk: false,
    proxy: null,
    proxyId: cfg.proxyId !== undefined ? cfg.proxyId : assignProxy(state),
    primary: !state.primaryBot && state.bots.length === 0,
    slot: 0,
    client: null,
  };
  state.bots.push(botRecord);
  if (botRecord.primary) state.primaryBot = name;
  connectBot(botRecord);

  log('info', `Added bot ${name} → ${cfg.host}:${cfg.port}`);
  broadcastState();
}

function connectBot(record) {
  if (!record) return;
  if (!state.bots.includes(record)) return;
  const opts = {
    host: record.host,
    port: record.port,
    username: record.name,
    version: record.version,
    auth: 'offline',
    physicsEnabled: record.physics !== false,
    checkTimeoutInterval: 120 * 1000,
    hideErrors: true,
  };

  if (record.proxyId) {
    const p = state.proxies.find(x => x.id === record.proxyId);
    if (p) {
      opts.auth = opts.auth || 'offline';
      opts.connect = (client) => {
        createProxyConnection(p, record.host, record.port)
          .then((socket) => {
            client.setSocket(socket);
            client.emit('connect');
          })
          .catch((err) => client.emit('error', err));
      };
    }
  }

  record.status = 'connecting';
  let client;
  try {
    client = mineflayer.createBot(opts);
  } catch (err) {
    record.status = 'error';
    log('error', `${record.name}: ${err.message}`);
    broadcastState();
    return;
  }
  record.client = client;

  client.on('spawn', () => {
    record.status = 'online';
    record.retryCount = 0;
    record.slot = 0;
    try { client.setQuickBarSlot(record.slot); } catch (e) {}
    log('success', `${record.name} spawned ✔`);
    applyBotState(record);
    broadcastState();
  });

  client.on('end', (reason) => {
    record.status = 'disconnected';
    cleanupBotTimers(record);
    log('warn', `${record.name} disconnected (${reason || 'end'})`);
    broadcastState();
    scheduleReconnect(record, 'end');
  });

  client.on('kicked', (reason) => {
    record.status = 'kicked';
    cleanupBotTimers(record);
    log('warn', `${record.name} kicked: ${String(reason).replace(/§[0-9a-fk-or]/g, '')}`);
    broadcastState();
    scheduleReconnect(record, 'kicked');
  });

  client.on('error', (err) => {
    record.status = 'error';
    cleanupBotTimers(record);
    log('error', `${record.name}: ${err.message}`);
    broadcastState();
    scheduleReconnect(record, 'error');
  });

  client.on('chat', (username, message) => {
    log('chat', `${username}: ${message}`);
    if (state.antiSpamEnabled && message && state.bots.some(b => b.name === username)) {
      // ignore our own echo
    }
  });
}

function scheduleReconnect(record, reason) {
  if (!state.bots.includes(record)) return;
  if (record._removing) return;
  const maxRetries = reason === 'kicked' ? 1 : 5;
  record.retryCount = (record.retryCount || 0) + 1;
  if (record.retryCount > maxRetries) {
    log('warn', `${record.name} — giving up after ${maxRetries} attempts`);
    broadcastState();
    return;
  }
  const delay = reason === 'kicked'
    ? 90 * 1000
    : 30 * 1000 + record.retryCount * 20 * 1000;
  clearTimeout(record._retryTimer);
  record._retryTimer = setTimeout(() => {
    if (state.bots.includes(record) && !record._removing) connectBot(record);
  }, delay);
  log('info', `${record.name} — reconnect in ${Math.round(delay / 1000)}s (attempt ${record.retryCount}/${maxRetries})`);
  broadcastState();
}

function cancelReconnect(record) {
  record._removing = true;
  clearTimeout(record._retryTimer);
  if (record.client) {
    try { record.client.quit(); record.client.end(); } catch (e) {}
  }
}

function removeBot(name) {
  const record = getBot(name);
  if (!record) return;
  cancelReconnect(record);
  cleanupBotTimers(record);
  state.bots = state.bots.filter(b => b.name !== name);
  if (state.primaryBot === name) {
    state.primaryBot = state.bots.length ? state.bots[0].name : null;
    if (state.primaryBot) getBot(state.primaryBot).primary = true;
  }
  log('info', `Removed ${name}`);
  broadcastState();
}

function cleanupBotTimers(record) {
  clearInterval(state.spinTimers.get(record.name));
  clearInterval(state.afkTimers.get(record.name));
  clearInterval(state.jumpTimers.get(record.name));
  clearInterval(state.moveTimers.get(record.name));
  clearInterval(state.flyTimers.get(record.name));
  state.spinTimers.delete(record.name);
  state.afkTimers.delete(record.name);
  state.jumpTimers.delete(record.name);
  state.moveTimers.delete(record.name);
  state.flyTimers.delete(record.name);
}

// ---------------------------------------------------------------------------
// Bot actions
// ---------------------------------------------------------------------------

function setSpin(record, stop) {
  record.spin = !stop;
  if (!record.client || record.status !== 'online') return;
  clearInterval(state.spinTimers.get(record.name));
  if (record.spin) {
    let yaw = 0;
    const timer = setInterval(() => {
      if (!record.client || record.status !== 'online') return;
      yaw += Math.PI / 4;
      try { record.client.look(yaw, 0); } catch (e) {}
    }, 150);
    state.spinTimers.set(record.name, timer);
  }
}

function setSneak(record) {
  record.sneak = !record.sneak;
  if (!record.client || record.status !== 'online') return;
  try {
    record.client.setControlState('sneak', record.sneak);
  } catch (e) {}
}

function setJump(record, stop) {
  record.jump = !stop;
  if (!record.client || record.status !== 'online') return;
  try { record.client.setControlState('jump', record.jump); } catch (e) {}
}

function setPhysics(record, enabled) {
  record.physics = !!enabled;
  if (!record.client) return;
  try { record.client.physicsEnabled = !!enabled; } catch (e) {}
}

function setAfk(record, stop) {
  record.afk = !stop;
  clearInterval(state.afkTimers.get(record.name));
  if (!record.afk) { state.afkTimers.delete(record.name); return; }
  const timer = setInterval(() => {
    if (!record.client || record.status !== 'online') return;
    const a = record.client;
    const rand = () => Math.random();
    try {
      if (rand() < 0.4) a.setControlState('jump', true);
      if (rand() < 0.3) a.activateItem();
      if (rand() < 0.3) {
        a.look(a.entity.yaw + (rand() < 0.5 ? 1 : -1) * Math.PI * 0.5, (rand() - 0.5) * 0.4);
      }
      setTimeout(() => { try { a.clearControlStates(); } catch (e) {} }, 400 + rand() * 600);
    } catch (e) {}
  }, 1500);
  state.afkTimers.set(record.name, timer);
}

function reconnectBot(name) {
  const record = getBot(name);
  if (!record) return;
  if (record.client) { try { record.client.end(); } catch (e) {} }
  cleanupBotTimers(record);
  setTimeout(() => connectBot(record), 300);
  log('info', `Reconnecting ${name}`);
}

function sendChat(target, message) {
  const bots = resolveTargets(target);
  bots.filter(b => b.status === 'online' && b.client).forEach(b => {
    try { b.client.chat(message); } catch (e) {}
  });
  log('chat', `→ ${String(target)}: ${message}`);
}

function sendSlot(target, slot) {
  const bots = resolveTargets(target);
  bots.filter(b => b.status === 'online' && b.client).forEach(b => {
    try { b.client.setQuickBarSlot(Math.max(0, Math.min(8, slot))); b.slot = slot; } catch (e) {}
  });
  broadcastState();
}

function sendMove(target, direction, blocks) {
  const bots = resolveTargets(target);
  const dirMap = { forward: 'forward', back: 'back', left: 'left', right: 'right' };
  const control = dirMap[direction];
  if (!control) return;
  bots.forEach(b => {
    if (b.status !== 'online' || !b.client) return;
    clearInterval(state.moveTimers.get(b.name));
    const dur = (blocks || 5) * 1000 / 4.317;
    b.client.setControlState(control, true);
    const timer = setTimeout(() => {
      try { b.client.setControlState(control, false); } catch (e) {}
      state.moveTimers.delete(b.name);
    }, Math.max(200, dur));
    state.moveTimers.set(b.name, timer);
  });
}

function sendFly(target, direction, blocks) {
  const bots = resolveTargets(target);
  bots.forEach(b => {
    if (b.status !== 'online' || !b.client) return;
    const control = direction === 'up' ? 'up' : 'down';
    try { b.client.creative.startFlying(); } catch (e) {}
    clearInterval(state.flyTimers.get(b.name));
    b.client.setControlState(control, true);
    const timer = setTimeout(() => {
      try {
        b.client.setControlState(control, false);
        b.client.creative.stopFlying();
      } catch (e) {}
      state.flyTimers.delete(b.name);
    }, (blocks || 5) * 200);
    state.flyTimers.set(b.name, timer);
  });
}

function setPrimary(name) {
  const newPrimary = getBot(name);
  if (!newPrimary) return;
  state.bots.forEach(b => { b.primary = false; });
  newPrimary.primary = true;
  state.primaryBot = name;
  log('info', `Primary bot → ${name}`);
  broadcastState();
}

function applyBotState(record) {
  if (!record.client || record.status !== 'online') return;
  try {
    if (record.spin) setSpin(record, false);
    if (record.sneak) record.client.setControlState('sneak', true);
    if (record.jump) record.client.setControlState('jump', true);
    if (record.afk) setAfk(record, false);
    record.client.physicsEnabled = record.physics;
    record.client.setQuickBarSlot(record.slot);
  } catch (e) {}
}

function triggerAutoRespawn() {
  state.bots.forEach(b => {
    if (b.client && b.status === 'online' && !b.client._respHandler) {
      b.client._respHandler = true;
      b.client.on('death', () => {
        try { b.client.respawn(); } catch (e) {}
      });
    }
  });
}

function startMassChat(target, message) {
  stopMassChat();
  state.massChatState = { enabled: true, target, message };
  state.massChatState.interval = setInterval(() => {
    sendChat(target, message);
  }, 5000);
  log('info', `Mass chat started → ${target}: ${message}`);
  broadcastState();
}

function stopMassChat() {
  if (state.massChatState.interval) clearInterval(state.massChatState.interval);
  state.massChatState = { enabled: false, target: '*', message: '', interval: null };
}

function startFollow() {
  stopFollow();
  if (!state.followState.leader) return;
  state.followState.active = true;
  const check = setInterval(() => {
    const bots = resolveTargets(state.followState.follower);
    let lastUser = null;
    bots.filter(b => b.status === 'online' && b.client).forEach(b => {
      const leaderName = lastUser || state.followState.leader;
      const ent = Object.values(b.client.entities).find(e => e.username === leaderName);
      if (!ent) return;
      const dist = b.client.entity.position.distanceTo(ent.position);
      try {
        if (dist > 2) {
          const v = ent.position.clone().subtract(b.client.entity.position).normalize();
          b.client.setControlState('forward', true);
          b.client.look(Math.atan2(-v.x, -v.z), 0);
        } else {
          b.client.setControlState('forward', false);
        }
      } catch (e) {}
      lastUser = b.name;
    });
  }, 700);
  state.followState._interval = check;
  log('info', `Follow mode ON (follower=${state.followState.follower}, leader=${state.followState.leader})`);
  broadcastState();
}

function stopFollow() {
  if (state.followState._interval) clearInterval(state.followState._interval);
  state.followState._interval = null;
  state.followState.active = false;
  resolveTargets(state.followState.follower).forEach(b => {
    if (!b.client) return;
    try { b.client.clearControlStates(); } catch (e) {}
  });
  broadcastState();
}

// ---------------------------------------------------------------------------
// Broadcasting
// ---------------------------------------------------------------------------

function buildState() {
  return {
    type: 'state',
    bots: state.bots.map(b => ({
      name: b.name, host: b.host, port: b.port, status: b.status,
      spin: b.spin, sneak: b.sneak, jump: b.jump, physics: b.physics, afk: b.afk,
      proxyId: b.proxyId, primary: b.primary, slot: b.slot,
    })),
    proxies: buildProxiesState(),
    botsPerProxy: state.botsPerProxy,
    proxyStats: {
      totalProxies: state.proxies.length,
      botsPerProxy: state.botsPerProxy,
      totalBotsCapacity: state.proxies.length * state.botsPerProxy,
    },
    autoRespawnEnabled: state.autoRespawnEnabled,
    massChatState: { enabled: state.massChatState.enabled, target: state.massChatState.target, message: state.massChatState.message },
    antiSpamEnabled: state.antiSpamEnabled,
    followState: { active: state.followState.active, follower: state.followState.follower, leader: state.followState.leader },
    primaryBot: state.primaryBot,
  };
}

function broadcastState() {
  const msg = JSON.stringify(buildState());
  wssClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function log(level, text) {
  const line = { type: 'log', level, text: String(text), time: new Date().toLocaleTimeString('en-GB', { hour12: false }) };
  logHistory.push(line);
  if (logHistory.length > 500) logHistory.shift();
  const msg = JSON.stringify(line);
  wssClients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  console.log(`[${line.time}] [${level.toUpperCase()}] ${text}`);
}

// ---------------------------------------------------------------------------
// Proxy actions
// ---------------------------------------------------------------------------

function testProxy(id, cb) {
  const p = state.proxies.find(x => x.id === id);
  if (!p) return;
  p.status = 'testing';
  broadcastState();
  // Test the proxy protocol against the first bot's target (or a known host)
  const testTarget = state.bots[0]
    ? { host: state.bots[0].host, port: state.bots[0].port }
    : { host: '1.1.1.1', port: 443 };
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    p.status = ok ? 'active' : 'failed';
    log(ok ? 'success' : 'warn', `Proxy ${p.type}://${p.host}:${p.port} ${ok ? 'OK' : 'FAILED'}`);
    broadcastState();
    if (cb) cb(ok);
  };
  createProxyConnection(p, testTarget.host, testTarget.port)
    .then((socket) => { socket.destroy(); finish(true); })
    .catch(() => finish(false));
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  wssClients.push(ws);
  log('info', 'Dashboard connected');
  ws.send(JSON.stringify(buildState()));
  logHistory.forEach(l => ws.send(JSON.stringify(l)));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    handleCommand(msg.cmd, msg.args || {});
  });

  ws.on('close', () => {
    wssClients = wssClients.filter(c => c !== ws);
    log('info', 'Dashboard disconnected');
  });
});

function handleCommand(cmd, args) {
  try {
    switch (cmd) {
      case 'load': {
        const accounts = loadBotAccounts();
        if (!accounts.length) { log('warn', 'bots.txt empty'); return; }
        const host = (args.host || '127.0.0.1').trim();
        const rawPort = parseInt(args.port, 10);
        if (args.port && (!rawPort || rawPort < 1 || rawPort > 65535)) {
          log('error', `Invalid port "${args.port}" — must be between 1 and 65535`);
          return;
        }
        const port = rawPort || 25565;
        if (!args.host || !args.port) {
          log('warn', `Server not set in config row — using 127.0.0.1:25565`);
        }
        const cfg = { host, port, version: args.version };
        const fresh = accounts.filter(name => !getBot(name));
        fresh.forEach((name, i) => {
          setTimeout(() => addBot(name, cfg), i * 3500);
        });
        log('success', `Loading ${fresh.length} bots from bots.txt → ${host}:${port} (staggered 3.5s)`);
        break;
      }
      case 'spin': resolveTargets(args.target).forEach(b => setSpin(b, args.stop)); break;
      case 'sneak': resolveTargets(args.target).forEach(b => setSneak(b)); break;
      case 'jump': resolveTargets(args.target).forEach(b => setJump(b, args.stop)); break;
      case 'physics': resolveTargets(args.target).forEach(b => setPhysics(b, args.state)); break;
      case 'afk': resolveTargets(args.target).forEach(b => setAfk(b, args.stop)); break;
      case 'reconnect': resolveTargets(args.target).forEach(b => reconnectBot(b.name)); break;
      case 'remove': removeBot(args.target); break;
      case 'chat': sendChat(args.target, args.message); break;
      case 'slot': sendSlot(args.target, args.slot); break;
      case 'move': sendMove(args.target, args.direction, args.blocks); break;
      case 'fly': sendFly(args.target, args.direction, args.blocks); break;
      case 'primary': setPrimary(args.target); break;

      case 'autorespawn':
        state.autoRespawnEnabled = !!args.enabled;
        if (state.autoRespawnEnabled) triggerAutoRespawn();
        log('info', `Auto-respawn ${state.autoRespawnEnabled ? 'ON' : 'OFF'}`);
        broadcastState();
        break;

      case 'masschat':
        if (args.enabled) startMassChat(args.target || '*', args.message || '');
        else { stopMassChat(); log('info', 'Mass chat stopped'); }
        broadcastState();
        break;

      case 'antispam':
        state.antiSpamEnabled = !!args.enabled;
        log('info', `Anti-spam ${state.antiSpamEnabled ? 'ON' : 'OFF'}`);
        broadcastState();
        break;

      case 'follow':
        if (args.enabled) {
          state.followState = { active: false, follower: args.follower || '*', leader: args.leader };
          startFollow();
        } else {
          stopFollow();
        }
        broadcastState();
        break;

      // ---------- Proxies ----------
      case 'proxy:add': {
        const p = parseProxy(args.raw, args.type);
        if (p) { state.proxies.push(p); log('success', `Proxy added ${p.type}://${p.host}:${p.port}`); }
        else log('error', 'Invalid proxy string');
        broadcastState();
        break;
      }
      case 'proxy:bulkAdd': {
        const lines = Array.isArray(args.lines) ? args.lines : [];
        let added = 0;
        lines.forEach(l => {
          const p = parseProxy(l, args.type);
          if (p) { state.proxies.push(p); added++; }
        });
        log('success', `Imported ${added}/${lines.length} proxies`);
        broadcastState();
        break;
      }
      case 'proxy:remove':
        state.proxies = state.proxies.filter(p => p.id !== args.id);
        state.bots.forEach(b => { if (b.proxyId === args.id) b.proxyId = null; });
        log('info', 'Proxy removed');
        broadcastState();
        break;
      case 'proxy:edit': {
        const p = state.proxies.find(x => x.id === args.id);
        if (p) {
          const parsed = parseProxy(args.raw, args.type);
          if (parsed) Object.assign(p, { type: parsed.type, host: parsed.host, port: parsed.port, username: parsed.username, password: parsed.password });
        }
        broadcastState();
        break;
      }
      case 'proxy:test': testProxy(args.id); break;
      case 'proxy:testAll': {
        state.proxies.forEach(p => testProxy(p.id));
        break;
      }
      case 'proxy:clear':
        state.proxies = [];
        state.bots.forEach(b => { b.proxyId = null; });
        log('info', 'All proxies cleared');
        broadcastState();
        break;
      case 'proxy:setPerBot':
        state.botsPerProxy = Math.max(1, parseInt(args.value, 10) || 1);
        log('info', `Bots per proxy → ${state.botsPerProxy}`);
        broadcastState();
        break;
      case 'proxy:loadFile':
        loadProxiesFile();
        break;

      default:
        log('warn', `Unknown command: ${cmd}`);
    }
    broadcastState();
  } catch (err) {
    log('error', `Command ${cmd} failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Static files + startup
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, HOST, () => {
  console.log(`Bot Controller backend listening on http://${HOST}:${PORT}`);
  log('success', 'Backend started');
  loadProxiesFile();
  const accounts = loadBotAccounts();
  if (accounts.length) log('info', `${accounts.length} bot accounts ready in bots.txt`);
});