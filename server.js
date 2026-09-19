const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const storage = require('./storage');

const ROOT = __dirname;
const DATA = storage.dataDir;
const UPLOADS = storage.uploadsDir;
const PUBLIC = path.join(ROOT, 'public');
const files = { users: 'users.json', conversations: 'conversations.json', messages: 'messages.json', presence: 'presence.json', typing: 'typing.json', pending: 'pending.json', ipmap: 'ipmap.json', visits: 'visits.json', banned: 'banned.json', reads: 'reads.json', calls: 'calls.json', tickets: 'tickets.json' };
const SECRET = process.env.SESSION_SECRET || 'nexchat-dev-secret-change-me';
const MAIN_ADMIN = String(process.env.MAIN_ADMIN || 'xmqrO').toLowerCase();
const isGod = (u) => !!u && String(u.username || '').toLowerCase() === MAIN_ADMIN;
const isOwner = (u) => !!u && (isGod(u) || u.role === 'owner');
const canAccessConv = (c, req) => !!c && (c.members.includes(req.uid) || isOwner(req.user));
const clientIp = (req) => { const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); return fwd || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'; };
const AUTH_BYPASS = process.env.AUTH_BYPASS === '1';
const DEMO_AUTO = 'NC-482913';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const GOOGLE_AUTH = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_FROM = process.env.BREVO_FROM || 'NexChat <no-reply@brevo.com>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'NexChat <onboarding@resend.dev>';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DISCORD_SUPPORT_CATEGORY_ID = process.env.DISCORD_SUPPORT_CATEGORY_ID || '1549762135955865670';
const DISCORD_SUPPORT_ROLE_ID = process.env.DISCORD_SUPPORT_ROLE_ID || '1549753769091276850';
const DISCORD_SUPPORT_INVITE = process.env.DISCORD_SUPPORT_INVITE || 'https://discord.gg/UwUqRtKYGQ';
const DISCORD_BOT_PUBLIC_KEY = process.env.DISCORD_BOT_PUBLIC_KEY || '';
const DISCORD_CLOSE_CUSTOM_ID = 'nexchat_close_ticket';
const DISCORD_EMBED_COLOR = 0x8b7cf6;
const DISCORD_EMBED_CLOSED = 0x2ecc71;
const SUPPORT_ENABLED = !!(DISCORD_BOT_TOKEN && DISCORD_GUILD_ID && DISCORD_SUPPORT_CATEGORY_ID && DISCORD_SUPPORT_ROLE_ID);

storage.ensure();
const defaultAppearance = () => ({ theme: 'midnight', gradient: 'violet', mode: 'dark' });
const demoUsers = [
  { id: 'NC-482913', name: 'Ahmed', username: 'ahmed', password: 'password', avatar: '', bio: 'Product designer & coffee enthusiast.', color: '#8b7cf6', appearance: defaultAppearance(), createdAt: new Date().toISOString() },
  { id: 'NC-735192', name: 'Mohamed', username: 'medo', password: 'password', avatar: '', bio: 'Building quietly, learning loudly.', color: '#32c5d2', appearance: defaultAppearance(), createdAt: new Date().toISOString() },
  { id: 'NC-918624', name: 'Sara', username: 'sara', password: 'password', avatar: '', bio: 'Creative soul. Say hello!', color: '#ff8a65', appearance: defaultAppearance(), createdAt: new Date().toISOString() },
  { id: 'NC-204817', name: 'Youssef', username: 'youssef', password: 'password', avatar: '', bio: 'Always up for a good conversation.', color: '#65d38a', appearance: defaultAppearance(), createdAt: new Date().toISOString() }
];

const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const memberId = () => `NC-${crypto.randomInt(100000, 999999)}`;
const clean = (value, max = 5000) => String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const GIF_HOST_ALLOW = /(^|\.)(klipy\.com|giphy\.com)$/i;
function isAllowedGifUrl(value) {
  try { const u = new URL(String(value)); return u.protocol === 'https:' && GIF_HOST_ALLOW.test(u.hostname); } catch { return false; }
}
function gifProviders() {
  const list = [];
  if (process.env.KLIPY_API_KEY) list.push(['klipy', process.env.KLIPY_API_KEY]);
  if (process.env.GIPHY_API_KEY) list.push(['giphy', process.env.GIPHY_API_KEY]);
  return list;
}
function normalizeKlipy(json) {
  const raw = json && json.data ? (Array.isArray(json.data.data) ? json.data.data : Array.isArray(json.data) ? json.data : []) : [];
  return raw.map((it) => {
    const f = (it && it.file) || {};
    const pick = (fmt) => { for (const s of [f.sm, f.md, f.hd, f.xs]) { if (s && s[fmt] && s[fmt].url) return s[fmt]; } return null; };
    const send = pick('gif') || pick('webp');
    if (!send || !isAllowedGifUrl(send.url)) return null;
    const prev = (f.sm && (f.sm.webp || f.sm.gif)) || (f.xs && (f.xs.webp || f.xs.gif)) || send;
    return { id: String(it.id || it.slug || send.url), title: it.title || '', url: send.url, preview: (prev && prev.url) || send.url, width: send.width || 220, height: send.height || 220, provider: 'klipy' };
  }).filter(Boolean);
}
function normalizeGiphy(json) {
  const raw = (json && json.data) || [];
  return raw.map((g) => {
    const im = (g && g.images) || {};
    const send = im.downsized || im.fixed_height || im.original;
    if (!send || !send.url || !isAllowedGifUrl(send.url)) return null;
    const prev = im.fixed_height_small || im.preview_gif || im.fixed_height || send;
    return { id: String(g.id || send.url), title: g.title || '', url: send.url, preview: (prev && prev.url) || send.url, width: parseInt(send.width, 10) || 200, height: parseInt(send.height, 10) || 200, provider: 'giphy' };
  }).filter(Boolean);
}
async function fetchFromProvider(name, key, { q, page, limit }) {
  if (name === 'klipy') {
    const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${q ? 'search' : 'trending'}`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(limit));
    url.searchParams.set('content_filter', 'medium');
    if (q) url.searchParams.set('q', q);
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Klipy ${r.status}`);
    return normalizeKlipy(await r.json());
  }
  const url = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  url.searchParams.set('api_key', key);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String((page - 1) * limit));
  url.searchParams.set('rating', 'pg-13');
  if (q) url.searchParams.set('q', q);
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`GIPHY ${r.status}`);
  return normalizeGiphy(await r.json());
}
async function fetchGifs({ q, page = 1, limit = 24 }) {
  const providers = gifProviders();
  if (!providers.length) return { configured: false, gifs: [], providers: [], provider: null };
  const settled = await Promise.all(providers.map(([name, key]) =>
    fetchFromProvider(name, key, { q, page, limit }).then(
      (gifs) => ({ name, gifs }),
      (err) => ({ name, gifs: [], err })
    )
  ));
  const ok = settled.filter((s) => s.gifs.length);
  if (!ok.length) {
    const failed = settled.find((s) => s.err);
    if (failed) throw failed.err;
    return { configured: true, gifs: [], providers: [], provider: providers[0][0] };
  }
  const seen = new Set();
  const merged = [];
  const maxLen = Math.max(...ok.map((s) => s.gifs.length));
  for (let i = 0; i < maxLen && merged.length < limit; i++) {
    for (const s of ok) {
      const g = s.gifs[i];
      if (g && !seen.has(g.url)) { seen.add(g.url); merged.push(g); if (merged.length >= limit) break; }
    }
  }
  const names = ok.map((s) => s.name);
  return { configured: true, gifs: merged, providers: names, provider: names[0] };
}
const safeUser = (u, onlineIds = new Set()) => ({ id: u.id, name: u.name || u.username, username: u.username, avatar: u.avatar, bio: u.bio, color: u.color, createdAt: u.createdAt, role: u.role || '', owner: isOwner(u), appearance: u.appearance || null, online: onlineIds.has(u.id) });
const PREF_DEFAULTS = { sound: true, desktop: false, preview: true, enterToSend: true, sendRead: true, sendTyping: true, invisible: false, autoplay: false, noiseIsolation: true, timeFormat: '12' };
const userPrefs = (u) => ({ ...PREF_DEFAULTS, ...((u && u.prefs && typeof u.prefs === 'object') ? u.prefs : {}) });
const selfUser = (u, online) => ({ ...safeUser(u, online), email: u.email || '', google: !!u.googleId, prefs: userPrefs(u) });

let seedPromise = null;
async function seed() {
  const users = await storage.readJson(files.users);
  const god = { id: 'NC-000001', name: 'xMqrO', username: 'xmqrO', password: process.env.ADMIN_PASSWORD || 'godmode', avatar: '', bio: 'Founder & absolute boss of NexChat.', color: '#ffd000', role: 'owner', appearance: defaultAppearance(), createdAt: new Date().toISOString() };
  if (users && users.length) {
    const godUser = users.find((u) => String(u.username || '').toLowerCase() === MAIN_ADMIN);
    if (godUser) {
      if (godUser.role !== 'owner') { godUser.role = 'owner'; await storage.writeJson(files.users, users); }
    } else {
      users.push(god);
      await storage.writeJson(files.users, users);
    }
    return;
  }
  await storage.writeJson(files.users, [...demoUsers, god]);
}
async function seeded() {
  if (!seedPromise) seedPromise = seed().catch((e) => { seedPromise = null; throw e; });
  await seedPromise;
}

function sign(obj) {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(raw) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (expect !== sig) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url')); return o.uid && o.exp > Date.now() ? o : null; } catch { return null; }
}
function shortSign(obj) {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function shortVerify(raw) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (expect !== sig) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url')); return o && o.exp > Date.now() ? o : null; } catch { return null; }
}
const cookieToken = (req) => req.headers.cookie?.match(/(?:^|;)\s*nexchat_session=([^;]+)/)?.[1] || '';
const currentUser = (req) => { const o = verify(cookieToken(req)); return o ? o.uid : null; };

async function onlineIds() {
  const raw = await storage.readJson(files.presence, true).catch(() => ({}));
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const now = Date.now();
  return new Set(Object.entries(p).filter(([, t]) => now - t < 60000).map(([uid]) => uid));
}
async function markOnline(uid) {
  let p = await storage.readJson(files.presence, true).catch(() => ({}));
  if (Array.isArray(p)) p = {};
  if (nowAgo(p[uid]) < 10000) return;
  p[uid] = Date.now();
  await storage.writeJson(files.presence, p);
}
const nowAgo = (t) => (t ? Date.now() - t : Infinity);
async function hydrateConversation(c, userId, online, typing) {
  const otherId = c.members.find((m) => m !== userId);
  const convMessages = (await storage.readJson(files.messages, true)).filter((m) => m.conversationId === c.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  let typ = null;
  const te = typing && typing[c.id];
  if (te && te.userId !== userId && te.userId === otherId && nowAgo(te.at) < 8000) {
    const tu = users.find((x) => x.id === te.userId);
    if (tu) typ = { user: safeUser(tu, online), isTyping: true };
  }
  const { theme: _theme, ...rest } = c;
  return { ...rest, other: safeUser(findUser(otherId) || { id: otherId, name: 'Unknown', username: 'Unknown', color: '#8b7cf6' }, online), lastMessage: convMessages[0] || null, unread: convMessages.filter((m) => m.senderId !== userId && m.status !== 'read').length, typing: typ };
}

let users = [];
let conversations = [];
let messages = [];
async function reloadLists() {
  [users, conversations, messages] = await Promise.all([storage.readJson(files.users), storage.readJson(files.conversations), storage.readJson(files.messages)]);
}
const findUser = (id2) => users.find((u) => u && u.id === id2);
const conversationFor = (a, b) => conversations.find((c) => Array.isArray(c?.members) && c.members.includes(a) && c.members.includes(b));

const app = express();
app.disable('x-powered-by');
app.use('/api/discord/interactions', express.raw({ type: 'application/json', limit: '3mb' }));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

/* ---------- security barrier: banned IPs cannot load anything ---------- */
let banCache = { list: [], at: 0 };
async function bannedList() { try { if (Date.now() - banCache.at < 3000) return banCache.list; const b = await storage.readJson(files.banned, true); banCache.list = (Array.isArray(b) ? b : []).filter((e) => e && e.ip); banCache.at = Date.now(); return banCache.list; } catch { return banCache.list; } }
const BANNED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexChat — access blocked</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e9eaf2;font-family:system-ui,sans-serif;text-align:center;padding:24px}.card{max-width:420px}.mark{width:54px;height:54px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#9c8fff,#6659dd);margin:0 auto 18px;font-weight:800;font-size:26px}.h{font-size:22px;margin:0 0 8px}.p{color:#8b93a8;font-size:14px;line-height:1.6;margin:0}</style></head><body><div class="card"><div class="mark">N</div><h1 class="h">Access blocked</h1><p class="p">This IP address has been banned from NexChat for security reasons. If you believe this is a mistake, contact the administrator.</p></div></body></html>`;
app.use(async (req, res, next) => {
  try {
    const b = await bannedList();
    if (b.some((e) => e && e.ip === clientIp(req))) {
      if (req.path.startsWith('/api') || /\.\w{1,5}$/.test(req.path)) return res.status(403).json({ error: 'Your IP address has been banned from NexChat.' });
      return res.status(403).type('html').send(BANNED_PAGE);
    }
  } catch { /* keep going if storage hiccups */ }
  next();
});

/* ---------- connection + visit tracking ---------- */
async function trackConnection(req, uid) {
  try {
    const ip = clientIp(req);
    const now = Date.now();
    let m = await storage.readJson(files.ipmap, true).catch(() => ({}));
    if (Array.isArray(m)) m = {};
    const prev = m[uid];
    if (prev && prev.ip === ip && now - prev.at < 20000) return;
    m[uid] = { ip, ua: String(req.headers['user-agent'] || '').slice(0, 160), at: now, firstSeen: prev ? prev.firstSeen : now };
    await storage.writeJson(files.ipmap, m);
  } catch { /* storage failure is non-fatal */ }
}
async function recordVisit(req) {
  try {
    const ip = clientIp(req);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let v = await storage.readJson(files.visits, true).catch(() => ({}));
    if (Array.isArray(v)) v = {};
    v.total = (v.total || 0) + 1;
    v.today = v.day === day ? (v.today || 0) + 1 : 1;
    v.year = v.year || {};
    v.year[day] = (v.year[day] || 0) + 1;
    v.day = day;
    const recent = (v.recent || []).filter((r) => now - (r.at || 0) < 7 * 86400000);
    recent.unshift({ ip, path: String(req.path || '/').slice(0, 120), ua: String(req.headers['user-agent'] || '').slice(0, 160), at: now });
    v.recent = recent.slice(0, 200);
    await storage.writeJson(files.visits, v);
  } catch { /* non-fatal */ }
}

const CANONICAL_HOST = 'hookhq.vercel.app';
const REDIRECT_HOSTS = new Set(['silk-line.vercel.app', 'knotwire.vercel.app', 'fetchtalk.vercel.app', 'nexchat-xmqro.vercel.app', 'nexchat-sooty-ten.vercel.app']);
app.use((req, res, next) => { const h = String(req.headers.host || '').split(':')[0].toLowerCase(); if (REDIRECT_HOSTS.has(h)) return res.redirect(307, 'https://' + CANONICAL_HOST + req.originalUrl); next(); });
app.use('/api', async (req, res, next) => { try { await seeded(); await reloadLists(); } catch {} next(); });

function requireUser(req, res, next) {
  let uid = currentUser(req);
  if (!uid && AUTH_BYPASS) uid = DEMO_AUTO;
  const user = findUser(uid) || (AUTH_BYPASS && uid === DEMO_AUTO ? demoUsers[0] : null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  req.uid = uid;
  next();
}
app.get('/api/health', (req, res) => { res.json({ bypass: AUTH_BYPASS, mode: storage.mode, bypassRaw: String(process.env.AUTH_BYPASS || '').split('').map((c) => c.charCodeAt(0)) }); });

const setCookie = (res, token, maxAge = true) => { const base = `nexchat_session=${token}; HttpOnly; SameSite=Lax; Path=/`; res.setHeader('Set-Cookie', maxAge ? `${base}; Max-Age=${30 * 24 * 60 * 60}` : `${base}; Max-Age=0`); };

const googleColors = ['#8b7cf6', '#32c5d2', '#ff8a65', '#65d38a', '#e68bd1'];
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
async function readPending() { return await storage.readJson(files.pending, true).catch(() => ({})); }
async function writePending(p) { await storage.writeJson(files.pending, p); }
function validDob(day, month, year) {
  const d = parseInt(day, 10), m = parseInt(month, 10), y = parseInt(year, 10);
  if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > new Date().getFullYear()) return null;
  const daysIn = new Date(y, m, 0).getDate();
  if (d > daysIn) return null;
  return { day: d, month: m, year: y };
}
async function sendVerificationEmail(to, code, purpose = 'verify') {
  const isReset = purpose === 'reset';
  const subject = isReset ? 'NexChat — reset your password' : 'NexChat — verify your email';
  const heading = isReset ? 'Reset your password' : 'Welcome to NexChat';
  const lead = isReset ? 'Use this code to confirm it&apos;s your account and choose a new password:' : 'Use this code to verify your email:';
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:14px"><h2 style="margin-top:0">${heading}</h2><p>${lead}</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#8b7cf6">${code}</p><p style="color:#6b7280;font-size:13px">The code expires in 10 minutes. If you didn't request this, you can ignore this email.</p></div>`;
  if (BREVO_API_KEY) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'NexChat', email: BREVO_FROM.includes('<') ? BREVO_FROM.match(/<([^>]+)>/)?.[1] : BREVO_FROM }, to: [{ email: to }], subject, htmlContent: html })
      });
      if (r.ok) return { sent: true, provider: 'brevo' };
      let detail = `brevo-${r.status}`;
      try { const j = await r.json(); if (j && (j.message || j.error)) detail = String(j.message || j.error).slice(0, 220); } catch { /* ignore */ }
      return { sent: false, reason: detail };
    } catch { return { sent: false, reason: 'network' }; }
  }
  if (RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: RESEND_FROM, to, subject, html })
      });
      if (r.ok) return { sent: true, provider: 'resend' };
      let detail = `resend-${r.status}`;
      try { const j = await r.json(); if (j && j.message) detail = String(j.message).slice(0, 220); } catch { /* ignore */ }
      return { sent: false, reason: detail };
    } catch (e) { return { sent: false, reason: 'network' }; }
  }
  return { sent: false, reason: 'no-key' };
}
app.get('/api/auth/google/config', (req, res) => {
  if (!GOOGLE_AUTH) return res.json({ enabled: false });
  res.json({ enabled: true, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, redirectTo: '/auth/callback' });
});
app.post('/api/auth/google/callback', async (req, res) => {
  if (!GOOGLE_AUTH) return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  const code = clean(req.body.code, 500);
  const verifier = clean(req.body.verifier, 200);
  if (!code || !/^[A-Za-z0-9._~-]{43,150}$/.test(verifier)) return res.status(400).json({ error: 'Invalid sign-in request.' });
  let data;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier })
    });
    data = await r.json();
    if (!r.ok) return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  } catch { return res.status(503).json({ error: 'Google sign-in is temporarily unavailable.' }); }
  if (!data || !data.user || !data.user.email || data.user.app_metadata?.provider !== 'google') return res.status(401).json({ error: 'Google sign-in could not be verified.' });
  const meta = data.user.user_metadata || {};
  const email = String(data.user.email).toLowerCase();
  const name = clean(meta.name || meta.full_name || meta.name || '', 40);
  const avatar = clean(meta.avatar_url || meta.picture || '', 500);
  const googleId = String(data.user.id || '');
  res.json({ link: shortSign({ kind: 'gl', email, name, avatar, googleId }), email, name });
});
app.post('/api/auth/google/link', async (req, res) => {
  const link = shortVerify(clean(req.body.link, 500));
  if (!link || link.kind !== 'gl') return res.status(401).json({ error: 'This Google sign-in has expired. Please try again.' });
  const email = String(link.email || '').toLowerCase();
  if (!email) return res.status(401).json({ error: 'This Google sign-in could not be verified.' });
  const username = clean(req.body.username, 32).toLowerCase();
  const name = clean(req.body.name, 40) || clean(link.name, 40) || username;
  const password = String(req.body.password || '');
  if (username.length < 3) return res.status(400).json({ error: 'Username must be 3+ characters.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters.' });
  const takenByOther = users.some((u) => u.username.toLowerCase() === username && (u.email || '').toLowerCase() !== email);
  if (takenByOther) return res.status(409).json({ error: 'That username is already taken.' });
  let u = users.find((x) => x.email && x.email.toLowerCase() === email);
  if (!u) {
    if (users.some((x) => x.email && x.email.toLowerCase() === email)) return res.status(409).json({ error: 'An account with that email already exists.' });
    u = { id: memberId(), name, username, password, email, googleId: link.googleId, avatar: link.avatar || '', bio: 'New to NexChat.', color: googleColors[users.length % googleColors.length], appearance: defaultAppearance(), createdAt: new Date().toISOString() };
    users.push(u);
    await storage.writeJson(files.users, users);
  } else {
    const autoPassword = !u.password || u.password.length === 32; // accounts created by the old auto Google flow
    if (!autoPassword && u.password !== password) return res.status(401).json({ error: 'That password does not match your existing NexChat account.' });
    u.name = name; u.username = username; u.password = password; u.email = email;
    u.googleId = u.googleId || link.googleId; u.avatar = u.avatar || link.avatar || '';
    await storage.writeJson(files.users, users);
  }
  setCookie(res, sign({ uid: u.id }));
  await markOnline(u.id);
  await trackConnection(req, u.id);
  res.json({ user: selfUser(u, await onlineIds()), linked: true });
});

app.post('/api/register', async (req, res) => {
  if (AUTH_BYPASS) return res.status(403).json({ error: 'Registration is temporarily disabled.' });
  const username = clean(req.body.username, 32), password = String(req.body.password || '');
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Username must be 3+ characters and password 4+ characters.' });
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  const rawEmail = clean(req.body.email, 120).toLowerCase();
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) return res.status(400).json({ error: 'Enter a valid email address, or leave it empty.' });
  if (rawEmail && users.some((u) => u.email && u.email.toLowerCase() === rawEmail)) return res.status(409).json({ error: 'An account with that email already exists. Try signing in with Google.' });
  let uid; do uid = memberId(); while (findUser(uid));
  const name = clean(req.body.name, 40) || username;
  const user = { id: uid, name, username, password, avatar: '', bio: 'New to NexChat.', color: ['#8b7cf6', '#32c5d2', '#ff8a65', '#65d38a', '#e68bd1'][users.length % 5], appearance: defaultAppearance(), createdAt: new Date().toISOString() };
  if (rawEmail) user.email = rawEmail;
  users.push(user);
  await storage.writeJson(files.users, users);
const token = sign({ uid: user.id });
  setCookie(res, token);
  await markOnline(user.id);
  await trackConnection(req, user.id);
  res.json({ user: selfUser(user, await onlineIds()) });
});

app.post('/api/register/step1', async (req, res) => {
  if (AUTH_BYPASS) return res.status(403).json({ error: 'Registration is temporarily disabled.' });
  const email = clean(req.body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const name = clean(req.body.name, 40);
  const username = clean(req.body.username, 32).toLowerCase();
  if (name.length < 2) return res.status(400).json({ error: 'Enter your display name.' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be 3+ characters.' });
  if (users.some((u) => u.email && u.email.toLowerCase() === email)) return res.status(409).json({ error: 'An account with that email already exists. Try signing in.' });
  if (users.some((u) => u.username.toLowerCase() === username)) return res.status(409).json({ error: 'That username is already taken.' });
  const dob = validDob(req.body.day, req.body.month, req.body.year);
  if (!dob) return res.status(400).json({ error: 'Enter a valid date of birth.' });
  const pend = await readPending();
  const key = `reg:${email}`;
  const now = Date.now();
  const previous = pend[key];
  if (previous && now - previous.sentAt < 60000) return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });
  const code = genCode();
  const send = await sendVerificationEmail(email, code, 'verify');
  if (!send.sent) return res.status(503).json({ error: send.reason === 'no-key' ? 'Email service not configured.' : 'Email delivery failed: ' + send.reason });
  pend[key] = { id: id('reg'), email, name, username, dob, codeHash: sha256(code), codeExp: now + 600000, verified: false, attempts: 0, sentAt: now, createdAt: now };
  await writePending(pend);
  res.json({ email });
});
app.post('/api/register/verify', async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const code = clean(req.body.code, 6);
  const pend = await readPending();
  const key = `reg:${email}`;
  const p = pend[key];
  if (!p || p.verified) return res.status(400).json({ error: 'No pending registration found for that email.' });
  if (p.codeExp < Date.now()) { delete pend[key]; await writePending(pend); return res.status(410).json({ error: 'That code has expired. Start over.' }); }
  p.attempts = (p.attempts || 0) + 1;
  if (p.attempts > 5) { delete pend[key]; await writePending(pend); return res.status(429).json({ error: 'Too many attempts. Please start over.' }); }
  if (!/^\d{6}$/.test(code) || sha256(code) !== p.codeHash) { await writePending(pend); return res.status(401).json({ error: 'That code is incorrect.' }); }
  p.verified = true;
  await writePending(pend);
  res.json({ token: shortSign({ kind: 'reg', email }) });
});
app.post('/api/register/complete', async (req, res) => {
  const token = shortVerify(clean(req.body.token, 500));
  if (!token || token.kind !== 'reg') return res.status(401).json({ error: 'Your sign-up session has expired. Please start over.' });
  const email = String(token.email || '').toLowerCase();
  const password = String(req.body.password || '');
  if (password.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters.' });
  const pend = await readPending();
  const key = `reg:${email}`;
  const p = pend[key];
  if (!p || !p.verified) return res.status(401).json({ error: 'Please verify your email first.' });
  if (users.some((u) => u.email && u.email.toLowerCase() === email)) return res.status(409).json({ error: 'That email already has an account.' });
  if (users.some((u) => u.username.toLowerCase() === p.username)) return res.status(409).json({ error: 'That username is already taken.' });
  const user = { id: memberId(), name: p.name, username: p.username, password, email, dob: p.dob, avatar: '', bio: 'New to NexChat.', color: googleColors[users.length % googleColors.length], appearance: defaultAppearance(), createdAt: new Date().toISOString() };
  users.push(user);
  await storage.writeJson(files.users, users);
  delete pend[key];
  await writePending(pend);
  setCookie(res, sign({ uid: user.id }));
  await markOnline(user.id);
  await trackConnection(req, user.id);
  res.json({ user: selfUser(user, await onlineIds()) });
});
app.post('/api/forgot', async (req, res) => {
  const identifier = clean(req.body.identifier, 120).toLowerCase();
  const u = users.find((x) => x.username.toLowerCase() === identifier || (x.email && x.email.toLowerCase() === identifier));
  if (!u || !u.email) { await new Promise((r) => setTimeout(r, 350)); return res.json({ ok: true, email: null }); }
  const email = u.email;
  const pend = await readPending();
  const key = `rst:${email}`;
  const now = Date.now();
  if (pend[key] && now - pend[key].sentAt < 60000) return res.status(429).json({ error: 'Please wait a moment before requesting another code.' });
  const code = genCode();
  const send = await sendVerificationEmail(email, code, 'reset');
  if (!send.sent) return res.status(503).json({ error: send.reason === 'no-key' ? 'Email service not configured.' : 'Email delivery failed: ' + send.reason });
  pend[key] = { id: id('rst'), email, codeHash: sha256(code), codeExp: now + 600000, verified: false, attempts: 0, sentAt: now, createdAt: now };
  await writePending(pend);
  res.json({ ok: true, email });
});
app.post('/api/forgot/verify', async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const code = clean(req.body.code, 6);
  const pend = await readPending();
  const key = `rst:${email}`;
  const p = pend[key];
  if (!p || p.verified) return res.status(400).json({ error: 'No reset request found for that email.' });
  if (p.codeExp < Date.now()) { delete pend[key]; await writePending(pend); return res.status(410).json({ error: 'That code has expired. Start over.' }); }
  p.attempts = (p.attempts || 0) + 1;
  if (p.attempts > 5) { delete pend[key]; await writePending(pend); return res.status(429).json({ error: 'Too many attempts. Please start over.' }); }
  if (!/^\d{6}$/.test(code) || sha256(code) !== p.codeHash) { await writePending(pend); return res.status(401).json({ error: 'That code is incorrect.' }); }
  p.verified = true;
  await writePending(pend);
  res.json({ token: shortSign({ kind: 'rst', email }) });
});
app.post('/api/reset', async (req, res) => {
  const token = shortVerify(clean(req.body.token, 500));
  if (!token || token.kind !== 'rst') return res.status(401).json({ error: 'Your reset session has expired. Please start over.' });
  const email = String(token.email || '').toLowerCase();
  const password = String(req.body.password || '');
  if (password.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters.' });
  const pend = await readPending();
  const key = `rst:${email}`;
  const p = pend[key];
  if (!p || !p.verified) return res.status(401).json({ error: 'Please verify your email first.' });
  const u = users.find((x) => x.email && x.email.toLowerCase() === email);
  if (!u) return res.status(404).json({ error: 'Account not found.' });
  u.password = password;
  await storage.writeJson(files.users, users);
  delete pend[key];
  await writePending(pend);
setCookie(res, sign({ uid: u.id }));
  await markOnline(u.id);
  await trackConnection(req, u.id);
  res.json({ user: safeUser(u, await onlineIds()) });
});

app.post('/api/login', async (req, res) => {
  const identifier = clean(req.body.identifier || req.body.username, 120).toLowerCase();
  const password = String(req.body.password || '');
  let user = users.find((u) => (u.username.toLowerCase() === identifier || (u.email && u.email.toLowerCase() === identifier)) && u.password === password);
  if (!user && AUTH_BYPASS) user = findUser(DEMO_AUTO) || demoUsers[0] || null;
  if (!user) return res.status(401).json({ error: 'Invalid email or username, or wrong password.' });
  const token = sign({ uid: user.id });
  setCookie(res, token);
  await markOnline(user.id);
  await trackConnection(req, user.id);
  res.json({ user: selfUser(user, await onlineIds()) });
});
app.post('/api/logout', requireUser, async (req, res) => {
  setCookie(res, '', false);
  const p = await storage.readJson(files.presence, true).catch(() => ({}));
  if (p[req.uid]) { p[req.uid] = 0; await storage.writeJson(files.presence, p); }
  res.json({ ok: true });
});
app.get('/api/me', async (req, res) => { const uid = currentUser(req) || (AUTH_BYPASS ? DEMO_AUTO : null); const u = findUser(uid) || (uid && AUTH_BYPASS ? demoUsers[0] : null); res.json({ user: u ? selfUser(u, await onlineIds()) : null }); });
app.get('/api/users/:id', requireUser, async (req, res) => { const u = findUser(clean(req.params.id, 30)); if (!u) return res.status(404).json({ error: 'User not found.' }); res.json({ user: safeUser(u, await onlineIds()) }); });
app.get('/api/users', requireUser, async (req, res) => { const q = String(req.query.q || '').toLowerCase(); const online = await onlineIds(); res.json({ users: users.filter((u) => u.id !== req.uid && (!q || u.username.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q) || u.id.toLowerCase().includes(q))).slice(0, 20).map((u) => safeUser(u, online)) }); });
app.put('/api/profile', requireUser, async (req, res) => {
  const u = findUser(req.uid);
  const username = clean(req.body.username || u.username, 32);
  if (users.some((x) => x.id !== u.id && x.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  u.name = clean(req.body.name || u.name || u.username, 40); u.username = username; u.bio = clean(req.body.bio ?? u.bio, 160);
  if (req.body.color) u.color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : u.color;
  await storage.writeJson(files.users, users);
  res.json({ user: safeUser(u, await onlineIds()) });
});
app.get('/api/appearance', requireUser, async (req, res) => {
  res.json({ appearance: req.user.appearance || defaultAppearance() });
});
app.put('/api/prefs', requireUser, async (req, res) => {
  const u = findUser(req.uid);
  const cur = userPrefs(u);
  const b = req.body || {};
  for (const k of ['sound', 'desktop', 'preview', 'enterToSend', 'sendRead', 'sendTyping', 'invisible', 'autoplay', 'noiseIsolation']) if (b[k] !== undefined) cur[k] = !!b[k];
  if (b.timeFormat === '12' || b.timeFormat === '24') cur.timeFormat = b.timeFormat;
  u.prefs = cur;
  await storage.writeJson(files.users, users);
  res.json({ prefs: cur });
});
app.post('/api/password', requireUser, async (req, res) => {
  const u = findUser(req.uid);
  const auto = !u.password || u.password.length === 32;
  if (!auto && String(req.body.current || '') !== u.password) return res.status(401).json({ error: 'Your current password is incorrect.' });
  const next = String(req.body.next || '');
  if (next.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters.' });
  u.password = next;
  await storage.writeJson(files.users, users);
  res.json({ ok: true });
});
app.put('/api/email', requireUser, async (req, res) => {
  const u = findUser(req.uid);
  const email = clean(req.body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (users.some((x) => x.id !== u.id && x.email && x.email.toLowerCase() === email)) return res.status(409).json({ error: 'That email already has an account.' });
  u.email = email;
  await storage.writeJson(files.users, users);
  res.json({ email });
});
app.del('/api/account', requireUser, async (req, res) => {
  const u = findUser(req.uid);
  if (isGod(u)) return res.status(403).json({ error: 'That account cannot be deleted.' });
  const auto = !u.password || u.password.length === 32;
  if (!auto && String(req.body.password || '') !== u.password) return res.status(401).json({ error: 'Incorrect password.' });
  if (auto && !req.body.confirm) return res.status(400).json({ error: 'Please confirm account deletion.' });
  const doomed = new Set(conversations.filter((c) => c.members.includes(u.id)).map((c) => c.id));
  users = users.filter((x) => x.id !== u.id);
  messages = messages.filter((m) => m.senderId !== u.id && !doomed.has(m.conversationId));
  conversations = conversations.filter((c) => !doomed.has(c.id));
  try {
    let reads = await storage.readJson(files.reads, true).catch(() => ({}));
    if (reads && typeof reads === 'object' && !Array.isArray(reads)) {
      for (const cid of Object.keys(reads)) {
        if (doomed.has(cid)) delete reads[cid];
        else if (reads[cid] && typeof reads[cid] === 'object' && reads[cid][u.id]) delete reads[cid][u.id];
      }
      await storage.writeJson(files.reads, reads);
    }
    const p = await storage.readJson(files.presence, true).catch(() => ({}));
    if (p && typeof p === 'object' && !Array.isArray(p) && p[u.id]) { delete p[u.id]; await storage.writeJson(files.presence, p); }
  } catch {}
  await storage.writeJson(files.users, users);
  await storage.writeJson(files.messages, messages);
  await storage.writeJson(files.conversations, conversations);
  setCookie(res, '', false);
  res.json({ ok: true });
});
app.put('/api/appearance', requireUser, async (req, res) => {
  const themes = ['midnight', 'ocean', 'ember', 'aurora', 'rose', 'gold'];
  const gradients = ['none', 'violet', 'ocean', 'sunset', 'aurora', 'rose', 'gold'];
  const cur = req.user.appearance || defaultAppearance();
  const next = {
    theme: themes.includes(req.body.theme) ? req.body.theme : cur.theme,
    gradient: gradients.includes(req.body.gradient) ? req.body.gradient : cur.gradient,
    mode: req.body.mode === 'light' ? 'light' : req.body.mode === 'dark' ? 'dark' : cur.mode
  };
  req.user.appearance = next;
  await storage.writeJson(files.users, users);
  res.json({ appearance: next });
});
app.get('/api/conversations', requireUser, async (req, res) => {
  const online = await onlineIds();
  const typing = await storage.readJson(files.typing, true).catch(() => ({}));
  const list = [];
  for (const c of conversations.filter((x) => x.members.includes(req.uid))) list.push(await hydrateConversation(c, req.uid, online, typing));
  list.sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
  res.json({ conversations: list });
});
app.post('/api/conversations', requireUser, async (req, res) => {
  const other = findUser(clean(req.body.memberId, 30));
  if (!other || other.id === req.uid) return res.status(404).json({ error: other ? 'You cannot message yourself.' : 'No user found.' });
  let c = conversationFor(req.uid, other.id);
  if (!c) { c = { id: id('conv'), members: [req.uid, other.id], createdAt: new Date().toISOString() }; conversations.push(c); await storage.writeJson(files.conversations, conversations); }
  res.json({ conversation: await hydrateConversation(c, req.uid, await onlineIds(), await storage.readJson(files.typing, true).catch(() => ({}))) });
});
app.get('/api/messages/:conversationId', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === req.params.conversationId && canAccessConv(x, req));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const since = clean(req.query.laterThan, 60);
  const list = (await storage.readJson(files.messages, true)).filter((m) => m.conversationId === c.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).filter((m) => !since || (m.createdAt && m.createdAt > since));
  res.json({ messages: list.map((m) => ({ ...m, sender: safeUser(findUser(m.senderId) || { id: m.senderId, username: 'Unknown', color: '#8b7cf6' }) })), members: c.members, read: ((await storage.readJson(files.reads, true).catch(() => ({}))) || {})[c.id] || {} });
});
app.post('/api/messages', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.body.conversationId, 40) && canAccessConv(x, req));
  const type = req.body.type === 'image' ? 'image' : req.body.type === 'video' ? 'video' : req.body.type === 'audio' ? 'audio' : 'text';
  const text = clean(req.body.content || '', type === 'text' ? 2000 : 500);
  if (!c || !text) return res.status(400).json({ error: 'Cannot send an empty message.' });
  if (type !== 'text' && !text.startsWith('/uploads/') && !((type === 'image' || type === 'video') && isAllowedGifUrl(text))) return res.status(400).json({ error: 'Invalid media attachment.' });
  const otherId = c.members.find((m) => m !== req.uid);
  const now = await onlineIds();
  const message = { id: id('msg'), conversationId: c.id, senderId: req.uid, type, content: text, status: now.has(otherId) ? 'delivered' : 'sent', createdAt: new Date().toISOString() };
  if (req.body.replyTo) {
    const target = messages.find((m) => m.id === clean(req.body.replyTo, 40) && m.conversationId === c.id);
    if (!target) return res.status(400).json({ error: 'The message you replied to no longer exists.' });
    const ts = findUser(target.senderId);
    message.reply = { id: target.id, senderId: target.senderId, name: (ts && (ts.name || ts.username)) || 'Unknown', type: target.type, preview: (target.type === 'image' || target.type === 'video') ? target.content : (target.content || '').slice(0, 150) };
  }
  if (req.body.tempId) message.tempId = clean(req.body.tempId, 30);
  if (req.body.forwarded) message.forwarded = true;
  messages.push(message);
  await storage.writeJson(files.messages, messages);
  res.json({ message: { ...message, sender: safeUser(req.user) } });
});
app.del('/api/messages/:messageId', requireUser, async (req, res) => {
  const msg = messages.find((x) => x.id === clean(req.params.messageId, 40));
  const conv = msg && conversations.find((x) => x.id === msg.conversationId && canAccessConv(x, req));
  if (!msg || !conv || (msg.senderId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Message not found.' });
  const idx = messages.indexOf(msg);
  if (idx > -1) messages.splice(idx, 1);
  await storage.writeJson(files.messages, messages);
  res.json({ ok: true, id: msg.id });
});
app.put('/api/messages/:messageId', requireUser, async (req, res) => {
  const msg = messages.find((x) => x.id === clean(req.params.messageId, 40));
  const conv = msg && conversations.find((x) => x.id === msg.conversationId && canAccessConv(x, req));
  if (!msg || !conv || (msg.senderId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Message not found.' });
  if (msg.type !== 'text') return res.status(400).json({ error: 'Only text messages can be edited.' });
  const text = clean(req.body.content || '', 2000);
  if (!text) return res.status(400).json({ error: 'Cannot send an empty message.' });
  msg.content = text;
  msg.edited = true;
  msg.editedAt = new Date().toISOString();
  await storage.writeJson(files.messages, messages);
  res.json({ message: { ...msg, sender: safeUser(findUser(msg.senderId) || req.user) } });
});
app.get('/api/gifs', requireUser, async (req, res) => {
  const q = clean(req.query.q || '', 80);
  const page = Math.max(1, Math.min(60, parseInt(req.query.page, 10) || 1));
  if (!gifProviders().length) return res.json({ configured: false, gifs: [], page, next: null });
  try {
    const out = await fetchGifs({ q, page });
    res.json({ configured: true, provider: out.provider, providers: out.providers || (out.provider ? [out.provider] : []), gifs: out.gifs, page, next: out.gifs.length ? page + 1 : null });
  } catch (e) {
    res.status(502).json({ error: 'GIF service unavailable.', detail: String((e && e.message) || e) });
  }
});
app.post('/api/messages/:conversationId/read', requireUser, async (req, res) => {  const c = conversations.find((x) => x.id === req.params.conversationId && canAccessConv(x, req));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  let changed = false;
  for (const m of messages) { if (m.conversationId === c.id && m.senderId !== req.uid && m.status !== 'read') { m.status = 'read'; changed = true; } }
  if (changed) await storage.writeJson(files.messages, messages);
  const others = messages.filter((m) => m.conversationId === c.id && m.senderId !== req.uid && m.createdAt).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const lastId = others.length ? others[others.length - 1].id : null;
  if (lastId) {
    let reads = await storage.readJson(files.reads, true).catch(() => ({}));
    if (!reads || typeof reads !== 'object' || Array.isArray(reads)) reads = {};
    reads[c.id] = { ...((reads[c.id] && typeof reads[c.id] === 'object') ? reads[c.id] : {}), [req.uid]: lastId };
    await storage.writeJson(files.reads, reads);
  }
  res.json({ ok: true, lastRead: lastId });
});
/* ---------- 1-on-1 voice calls: server holds tickets + call state, media is P2P WebRTC, SDP/ICE travel over realtime broadcast ---------- */
const CALL_RING_MS = 60000, CALL_ACTIVE_MS = 2 * 60 * 60 * 1000, CALL_PING_MS = 40000;
function touchCall(c) { const iso = new Date().toISOString(); c.updatedAt = iso; c.lastPing = iso; }
async function readCalls() {
  const r = await storage.readJson(files.calls, true).catch(() => ({}));
  return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
}
function callAlive(c) {
  if (!c) return false;
  const age = Date.now() - new Date(c.updatedAt || c.createdAt || 0).getTime();
  if (c.state === 'ringing') return age < CALL_RING_MS;
  if (c.state === 'active') {
    if (age >= CALL_ACTIVE_MS) return false;
    const pingAge = Date.now() - new Date(c.lastPing || c.updatedAt || c.createdAt || 0).getTime();
    return pingAge < CALL_PING_MS;
  }
  return false;
}
function userBusy(calls, uid, exceptId) {
  return Object.values(calls).some((c) => c.id !== exceptId && callAlive(c) && (c.callerId === uid || c.calleeId === uid));
}
async function sweepCalls(calls) {
  let dropped = false;
  for (const cid of Object.keys(calls)) if (!callAlive(calls[cid])) { delete calls[cid]; dropped = true; }
  if (dropped) await storage.writeJson(files.calls, calls);
  return calls;
}
app.get('/api/calls/config', requireUser, async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.json({ enabled: false });
  res.json({ enabled: true, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
});
app.post('/api/calls/invite', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.body.conversationId, 40) && canAccessConv(x, req));
  if (!c || !Array.isArray(c.members) || c.members.length !== 2) return res.status(404).json({ error: 'Conversation not found.' });
  const otherId = c.members.find((m) => m !== req.uid);
  if (!otherId) return res.status(400).json({ error: 'Voice calls are strictly 1-on-1.' });
  const calls = await sweepCalls(await readCalls());
  if (userBusy(calls, req.uid)) return res.status(409).json({ error: 'You are already in a call.', code: 'BUSY_SELF' });
  if (userBusy(calls, otherId)) return res.status(409).json({ error: 'They are already in another call.', code: 'BUSY' });
  const call = { id: id('call'), conversationId: c.id, callerId: req.uid, calleeId: otherId, state: 'ringing', video: !!req.body.video, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  calls[call.id] = call;
  await storage.writeJson(files.calls, calls);
  res.json({ call, ticket: shortSign({ kind: 'call', call: call.id }) });
});
app.post('/api/calls/verify', requireUser, async (req, res) => {
  const t = shortVerify(clean(req.body.ticket, 800));
  if (!t || t.kind !== 'call') return res.status(401).json({ error: 'Invalid call invitation.' });
  const calls = await readCalls();
  const call = calls[t.call];
  if (!call || !callAlive(call) || (call.state !== 'ringing' && call.state !== 'active')) return res.status(410).json({ error: 'This call is no longer active.' });
  if (call.calleeId !== req.uid && call.callerId !== req.uid && !isOwner(req.user)) return res.status(403).json({ error: 'Not your call.' });
  res.json({ call });
});
app.post('/api/calls/:id/accept', requireUser, async (req, res) => {
  const calls = await sweepCalls(await readCalls());
  const call = calls[clean(req.params.id, 40)];
  if (!call || call.state !== 'ringing' || !callAlive(call)) return res.status(409).json({ error: 'This call is no longer ringing.', code: 'GONE' });
  if (call.calleeId !== req.uid) return res.status(403).json({ error: 'Only the person called can accept.' });
  if (userBusy(calls, call.callerId, call.id) || userBusy(calls, call.calleeId, call.id)) return res.status(409).json({ error: 'Someone is already in another call.', code: 'BUSY' });
  call.state = 'active';
  touchCall(call);
  await storage.writeJson(files.calls, calls);
  res.json({ ok: true, call });
});
app.post('/api/calls/:id/ping', requireUser, async (req, res) => {
  const calls = await readCalls();
  const call = calls[clean(req.params.id, 40)];
  if (!call) return res.json({ ok: true, gone: true });
  if (call.callerId !== req.uid && call.calleeId !== req.uid && !isOwner(req.user)) return res.status(403).json({ error: 'Not your call.' });
  touchCall(call);
  await storage.writeJson(files.calls, calls);
  res.json({ ok: true });
});
app.post('/api/calls/:id/end', requireUser, async (req, res) => {
  const calls = await readCalls();
  const call = calls[clean(req.params.id, 40)];
  if (!call) return res.json({ ok: true });
  if (call.callerId !== req.uid && call.calleeId !== req.uid && !isOwner(req.user)) return res.status(403).json({ error: 'Not your call.' });
  delete calls[call.id];
  await storage.writeJson(files.calls, calls);
  res.json({ ok: true });
});
/* ---------- Discord support tickets: server acts as the bot via its REST token ---------- */
const discordApi = async (method, path, body) => {
  if (!DISCORD_BOT_TOKEN) throw Object.assign(new Error('Discord support is not configured.'), { code: 'NO_DISCORD' });
  const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'NexChat/1.0 (https://hookhq.vercel.app; support bridge)' };
  let res;
  const attempt = async () => {
    try { return await fetch('https://discord.com/api/v10' + path, { method, headers, body: body == null ? undefined : JSON.stringify(body) }); }
    catch { return Object.assign(new Error('Discord is unreachable.'), { unreachable: true }); }
  };
  res = await attempt();
  if (res && res.unreachable) throw res;
  if (res.status === 429) {
    const wait = Math.min(10, Math.max(0.5, parseFloat(res.headers.get('retry-after') || '1') || 1)) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    res = await attempt();
    if (res && res.unreachable) throw res;
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.message || j.code)) ? String(j.message || j.code) : ''; } catch { /* ignore */ }
    throw Object.assign(new Error('Discord request failed (' + res.status + (detail ? ': ' + detail : '') + ')'), { status: res.status });
  }
  if (res.status === 204) return null;
  try { return await res.json(); } catch { return null; }
};
let discordBotIdPromise = null;
const discordBotId = () => {
  if (!discordBotIdPromise) discordBotIdPromise = discordApi('GET', '/users/@me').then((u) => (u && u.id) || null).catch(() => null);
  return discordBotIdPromise;
};
const fmtDiscordCloser = (u) => String((u && (u.global_name || u.username)) || 'Discord staff').slice(0, 40);
const ticketWelcomeEmbed = (ticket, channelName) => ({
  color: DISCORD_EMBED_COLOR,
  title: `Support ticket #${ticket.number}`,
  description: 'A NexChat user opened a support ticket. Staff replies in this channel appear instantly on the user\'s website ticket.',
  fields: [
    { name: 'User', value: `@${String(ticket.username || 'user').slice(0, 60)}`, inline: true },
    { name: 'Website', value: 'NexChat', inline: true }
  ],
  timestamp: ticket.createdAt,
  footer: { text: `Ticket #${ticket.number} · use the button below to close it` }
});
const ticketUserEmbed = (ticket, content, at, reply) => ({
  color: DISCORD_EMBED_COLOR,
  author: { name: `@${String(ticket.username || 'user').slice(0, 40)} · NexChat` },
  description: reply ? `> @${String(reply.author || 'unknown').slice(0, 40)}: ${String(reply.preview || '').slice(0, 150)}\n\n${content}` : content,
  timestamp: at
});
const ticketClosedEmbed = (ticket, closer) => ({
  color: DISCORD_EMBED_CLOSED,
  title: `Support ticket #${ticket.number} · Closed`,
  description: `This ticket was closed by @${closer} and the channel is now locked.`,
  timestamp: ticket.closedAt || new Date().toISOString(),
  footer: { text: 'NexChat · support' }
});
const snowGt = (a, b) => { const x = String(a || ''), y = String(b || ''); if (!x) return false; if (!y) return true; if (x.length !== y.length) return x.length > y.length; return x > y; };
const cleanSupportName = (n) => String(n || 'user').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'user';
async function readSupportTickets() {
  const r = await storage.readJson(files.tickets, true).catch(() => ({}));
  return (r && typeof r === 'object' && !Array.isArray(r)) ? { counter: Number(r.counter) || 0, tickets: Array.isArray(r.tickets) ? r.tickets : [] } : { counter: 0, tickets: [] };
}
async function writeSupportTickets(s) { await storage.writeJson(files.tickets, s); }
const supportTicketSummary = (t) => t ? ({ id: t.id, number: t.number, status: t.status, createdAt: t.createdAt, closedAt: t.closedAt || null, lastMessage: (t.messages && t.messages.length) ? t.messages[t.messages.length - 1] || null : null, updatedAt: (t.messages && t.messages.length) ? t.messages[t.messages.length - 1].createdAt : t.createdAt }) : null;
app.get('/api/support/config', requireUser, (req, res) => { res.json({ enabled: SUPPORT_ENABLED, invite: DISCORD_SUPPORT_INVITE, oneOpen: true }); });
app.get('/api/support/tickets', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const mine = s.tickets.filter((t) => t.userId === req.uid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const open = mine.find((t) => t.status === 'open') || null;
  res.json({ open: supportTicketSummary(open), tickets: mine.map(supportTicketSummary) });
});
app.post('/api/support/tickets', requireUser, async (req, res) => {
  if (!SUPPORT_ENABLED) return res.status(503).json({ error: 'Support is not configured on this server yet.' });
  const s = await readSupportTickets();
  const existing = s.tickets.find((t) => t.userId === req.uid && t.status === 'open') || null;
  if (existing) return res.json({ ticket: existing, reused: true });
  const botId = await discordBotId();
  if (!botId) return res.status(502).json({ error: 'The Discord bot is not reachable right now.' });
  const number = (s.counter || 0) + 1;
  const overwrites = [
    { id: DISCORD_GUILD_ID, type: 0, deny: '1024' },
    { id: DISCORD_SUPPORT_ROLE_ID, type: 0, allow: '109568' },
    { id: botId, type: 0, allow: '125968' }
  ];
  let channel;
  try {
    channel = await discordApi('POST', `/guilds/${DISCORD_GUILD_ID}/channels`, {
      name: `ticket-${number}-${cleanSupportName(req.user.username || req.user.name)}`,
      type: 0,
      parent_id: DISCORD_SUPPORT_CATEGORY_ID,
      topic: `Support Ticket #${number} | NexChat: @${String(req.user.username || req.user.name).slice(0, 30)}`,
      permission_overwrites: overwrites
    });
  } catch (e) { return res.status(502).json({ error: 'Could not create the ticket in Discord: ' + (e.message || 'unknown error') }); }
  if (!channel || !channel.id) return res.status(502).json({ error: 'Discord did not return a ticket channel.' });
  const createdAt = new Date().toISOString();
  const ticket = { id: id('tkt'), number, channelId: channel.id, userId: req.uid, username: req.user.username || req.user.name, name: req.user.name || req.user.username, status: 'open', createdAt, closedAt: null, welcomeMessageId: null, lastDiscordId: null, messages: [] };
  let welcomeRes = null;
  try {
    welcomeRes = await discordApi('POST', `/channels/${channel.id}/messages`, {
      embeds: [ticketWelcomeEmbed(ticket, channel.name || '')],
      components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Close ticket', emoji: { name: '🔒' }, custom_id: DISCORD_CLOSE_CUSTOM_ID }] }]
    });
  } catch { /* welcome message is best-effort */ }
  ticket.welcomeMessageId = (welcomeRes && welcomeRes.id) || null;
  ticket.messages.push({ id: id('tm'), kind: 'system', author: 'NexChat', content: `Ticket #${number} opened by @${String(req.user.username || req.user.name).slice(0, 40)}. Staff replies land here automatically.`, createdAt });
  s.counter = number;
  s.tickets.push(ticket);
  await writeSupportTickets(s);
  res.json({ ticket });
});
app.get('/api/support/tickets/:id', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => x.id === clean(req.params.id, 40)) || null;
  if (!t || (t.userId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Ticket not found.' });
  if (t.status === 'open') {
    try {
      const msgs = await discordApi('GET', `/channels/${t.channelId}/messages?limit=50`) || [];
      if (Array.isArray(msgs) && msgs.length && msgs[0].id) {
        const botId = await discordBotId();
        const maxId = msgs[0].id;
        let added = 0;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (!m || !m.id || !snowGt(m.id, t.lastDiscordId)) continue;
          if (m.author && String(m.author.id) === String(botId)) continue;
          const content = clean(m.content, 2000);
          if (!content) continue;
          t.messages.push({ id: 'd' + m.id, kind: 'staff', author: (m.author && (m.author.global_name || m.author.username)) || 'Support Team', content, createdAt: m.timestamp || new Date().toISOString() });
          added++;
        }
        if (added || snowGt(maxId, t.lastDiscordId)) t.lastDiscordId = maxId;
        if (added) await writeSupportTickets(s);
      }
    } catch { /* relay is best-effort */ }
  }
  res.json({ ticket: t });
});
app.post('/api/support/tickets/:id/messages', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => x.id === clean(req.params.id, 40)) || null;
  if (!t || (t.userId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Ticket not found.' });
  if (t.status !== 'open') return res.status(409).json({ error: 'This ticket is already closed.' });
  const content = clean(req.body.content, 2000);
  if (!content) return res.status(400).json({ error: 'Cannot send an empty message.' });
  const replyTo = clean(req.body.replyTo, 60);
  const replied = replyTo ? (t.messages.find((m) => m.id === replyTo) || null) : null;
  const reply = replied ? { id: replied.id, author: replied.author || (replied.kind === 'staff' ? 'Support Team' : t.name || t.username), preview: String(replied.content || '').slice(0, 150) } : null;
  const at = new Date().toISOString();
  let discordRes = null;
  try {
    discordRes = await discordApi('POST', `/channels/${t.channelId}/messages`, { embeds: [ticketUserEmbed(t, content, at, reply)] });
  } catch (e) { return res.status(502).json({ error: 'Could not reach the Discord ticket: ' + (e.message || 'unknown error') }); }
  const message = { id: id('tm'), kind: 'user', author: t.name || t.username, content, createdAt: at, discordId: (discordRes && discordRes.id) || null };
  if (reply) message.reply = reply;
  t.messages.push(message);
  await writeSupportTickets(s);
  res.json({ message });
});
app.put('/api/support/tickets/:id/messages/:messageId', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => x.id === clean(req.params.id, 40)) || null;
  if (!t || (t.userId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Ticket not found.' });
  const m = t.messages.find((x) => x.id === clean(req.params.messageId, 60)) || null;
  if (!m) return res.status(404).json({ error: 'Message not found.' });
  if (m.kind !== 'user') return res.status(400).json({ error: 'Only your own messages can be edited.' });
  const content = clean(req.body.content, 2000);
  if (!content) return res.status(400).json({ error: 'Cannot send an empty message.' });
  m.content = content;
  m.edited = true;
  m.editedAt = new Date().toISOString();
  if (SUPPORT_ENABLED && m.discordId) {
    try { await discordApi('PATCH', `/channels/${t.channelId}/messages/${m.discordId}`, { embeds: [ticketUserEmbed(t, content, m.createdAt, m.reply || null)] }); } catch { /* best-effort */ }
  }
  await writeSupportTickets(s);
  res.json({ message: m });
});
app.del('/api/support/tickets/:id/messages/:messageId', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => x.id === clean(req.params.id, 40)) || null;
  if (!t || (t.userId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Ticket not found.' });
  const idx = t.messages.findIndex((x) => x.id === clean(req.params.messageId, 60));
  if (idx === -1) return res.status(404).json({ error: 'Message not found.' });
  const m = t.messages[idx];
  if (m.kind !== 'user') return res.status(400).json({ error: 'Only your own messages can be deleted.' });
  if (SUPPORT_ENABLED && m.discordId) {
    try { await discordApi('DELETE', `/channels/${t.channelId}/messages/${m.discordId}`); } catch { /* best-effort */ }
  }
  t.messages.splice(idx, 1);
  await writeSupportTickets(s);
  res.json({ ok: true, id: m.id });
});
app.post('/api/support/tickets/:id/close', requireUser, async (req, res) => {
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => x.id === clean(req.params.id, 40)) || null;
  if (!t || (t.userId !== req.uid && !isOwner(req.user))) return res.status(404).json({ error: 'Ticket not found.' });
  if (t.status === 'closed') return res.json({ ticket: t });
  t.status = 'closed';
  t.closedAt = new Date().toISOString();
  t.messages.push({ id: id('tm'), kind: 'system', author: 'NexChat', content: `Ticket #${t.number} closed by @${String(req.user.username || req.user.name).slice(0, 40)}.`, createdAt: t.closedAt });
  if (SUPPORT_ENABLED) {
    try {
      await discordApi('PATCH', `/channels/${t.channelId}`, { name: `closed-${cleanSupportName(t.username || t.name || 'user')}`, locked: true });
    } catch { /* rename is best-effort */ }
    if (t.welcomeMessageId) {
      try { await discordApi('PATCH', `/channels/${t.channelId}/messages/${t.welcomeMessageId}`, { embeds: [ticketClosedEmbed(t, String(req.user.username || req.user.name).slice(0, 40) || 'NexChat staff')], components: [] }); } catch { /* best-effort */ }
    }
  }
  await writeSupportTickets(s);
  res.json({ ticket: t });
});
function verifyDiscordInteraction(req, raw) {
  if (!DISCORD_BOT_PUBLIC_KEY) return true;
  try {
    const sig = Buffer.from(String(req.headers['x-signature-ed25519'] || ''), 'hex');
    const ts = Buffer.from(String(req.headers['x-signature-timestamp'] || ''), 'utf8');
    if (!sig.length || !ts.length || !Buffer.isBuffer(raw)) return false;
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(DISCORD_BOT_PUBLIC_KEY, 'hex')]);
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    const v = crypto.createVerify('ed25519');
    v.update(Buffer.concat([ts, raw]));
    v.end();
    return v.verify(pem, sig);
  } catch { return false; }
}
async function closeTicketFromInteraction(it) {
  const channelId = String((it.channel && it.channel.id) || (it.message && it.message.channel_id) || '');
  const closer = fmtDiscordCloser(it.member && it.member.user) || 'Discord staff';
  if (!channelId) return;
  const s = await readSupportTickets();
  const t = s.tickets.find((x) => String(x.channelId || '') === channelId) || null;
  if (!t) {
    try { await discordApi('PATCH', `/webhooks/${it.application_id}/${it.token}/messages/@original`, { embeds: [{ color: DISCORD_EMBED_CLOSED, title: 'Ticket closed', description: 'This ticket could not be found or was already removed.' }], components: [] }); } catch { /* best-effort */ }
    return;
  }
  if (t.status === 'open') {
    t.status = 'closed';
    t.closedAt = new Date().toISOString();
    t.messages.push({ id: id('tm'), kind: 'system', author: 'NexChat', content: `Ticket #${t.number} closed from Discord by @${closer}.`, createdAt: t.closedAt });
  }
  try {
    await discordApi('PATCH', `/channels/${t.channelId}`, { name: `closed-${cleanSupportName(t.username || t.name || 'user')}`, locked: true });
  } catch { /* best-effort */ }
  try {
    await discordApi('PATCH', `/webhooks/${it.application_id}/${it.token}/messages/@original`, { embeds: [ticketClosedEmbed(t, closer)], components: [] });
  } catch { /* best-effort */ }
  await writeSupportTickets(s);
}
app.post('/api/discord/interactions', async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  if (!verifyDiscordInteraction(req, raw)) return res.status(401).json({ error: 'Invalid request signature' });
  let it = null;
  try { it = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid interaction payload' }); }
  if (!it) return res.status(400).json({ error: 'Invalid interaction payload' });
  if (it.type === 1) return res.json({ type: 1 });
  if (it.type === 3 && it.data && it.data.custom_id === DISCORD_CLOSE_CUSTOM_ID) {
    res.json({ type: 6 });
    try { await closeTicketFromInteraction(it); } catch (e) { console.error('ticket close interaction failed', e); }
    return;
  }
  res.json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
});
app.post('/api/presence', requireUser, async (req, res) => { await markOnline(req.uid); await trackConnection(req, req.uid); res.json({ ok: true }); });
app.post('/api/typing', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.body.conversationId, 40) && x.members.includes(req.uid));
  if (!c) return res.json({ ok: true });
  const typing = await storage.readJson(files.typing, true).catch(() => ({}));
  if (req.body.isTyping) { const prev = typing[c.id]; if (prev && prev.userId === req.uid && nowAgo(prev.at) < 2000) return res.json({ ok: true }); typing[c.id] = { userId: req.uid, at: Date.now() }; }
  else if (typing[c.id]?.userId === req.uid) delete typing[c.id];
  else return res.json({ ok: true });
  await storage.writeJson(files.typing, typing);
  res.json({ ok: true });
});
app.get('/api/typing/:conversationId', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.params.conversationId, 40) && x.members.includes(req.uid));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const otherId = c.members.find((m) => m !== req.uid);
  const typing = await storage.readJson(files.typing, true).catch(() => ({}));
  const te = typing[c.id];
  if (te && te.userId === otherId && nowAgo(te.at) < 8000) {
    const tu = findUser(te.userId) || { id: te.userId, name: 'Unknown', username: 'Unknown', color: '#8b7cf6' };
    return res.json({ isTyping: true, user: safeUser(tu, await onlineIds()) });
  }
  res.json({ isTyping: false, user: null });
});

/* ---------- admin dashboard & moderation ---------- */
function requireAdmin(req, res, next) { if (!req.user || !isOwner(req.user)) return res.status(403).json({ error: 'Admin access required.' }); next(); }
app.get('/api/admin/stats', requireUser, requireAdmin, async (req, res) => {
  const online = await onlineIds();
  const v = await storage.readJson(files.visits, true).catch(() => ({}));
  const b = await bannedList();
  res.json({ users: users.length, conversations: conversations.length, messages: messages.length, online: online.size, owners: users.filter((u) => isOwner(u)).map((u) => u.username), bans: b.map((e) => e.ip), visits: { total: v.total || 0, today: v.today || 0, day: v.day || null, year: v.year || {} } });
});
app.get('/api/admin/online', requireUser, requireAdmin, async (req, res) => {
  const now = Date.now();
  const p = await storage.readJson(files.presence, true).catch(() => ({}));
  const m = await storage.readJson(files.ipmap, true).catch(() => ({}));
  const onlineSet = new Set(Object.entries(p).filter(([, t]) => now - t < 60000).map(([uid]) => uid));
  const online = [...onlineSet].map((uid) => { const u = findUser(uid); const info = m[uid] || {}; return { user: u ? safeUser(u, onlineSet) : null, userId: uid, ip: info.ip || null, ua: info.ua || '', lastSeen: p[uid] || 0, firstSeen: info.firstSeen || 0 }; }).sort((a, b) => b.lastSeen - a.lastSeen);
  const recent = Object.entries(m).map(([uid, info]) => ({ userId: uid, user: safeUser(findUser(uid) || { id: uid, name: 'Unknown', username: 'Unknown', color: '#8b7cf6' }), ip: info.ip || null, ua: info.ua || '', seen: info.at || 0 })).sort((a, b) => b.seen - a.seen).slice(0, 60);
  res.json({ online, recent });
});
app.get('/api/admin/users', requireUser, requireAdmin, async (req, res) => {
  const online = await onlineIds();
  const m = await storage.readJson(files.ipmap, true).catch(() => ({}));
  res.json({ users: users.map((u) => ({ ...safeUser(u, online), email: u.email || '', lastIp: (m[u.id] || {}).ip || null, lastSeen: (m[u.id] || {}).at || 0 })) });
});
app.get('/api/admin/conversations', requireUser, requireAdmin, async (req, res) => {
  const online = await onlineIds();
  const allMsgs = await storage.readJson(files.messages, true);
  const list = conversations.map((c) => {
    const [aId, bId] = Array.isArray(c.members) && c.members.length === 2 ? c.members : [c.members[0], c.members[1] || c.members[0]];
    const cm = allMsgs.filter((m2) => m2.conversationId === c.id).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
    return { id: c.id, members: [safeUser(findUser(aId) || { id: aId, name: 'Deleted user', username: 'deleted', color: '#8b7cf6' }, online), safeUser(findUser(bId) || { id: bId, name: 'Deleted user', username: 'deleted', color: '#8b7cf6' }, online)], lastMessage: cm[0] || null, messageCount: cm.length, createdAt: c.createdAt };
  }).sort((x, y) => new Date(y.lastMessage?.createdAt || y.createdAt) - new Date(x.lastMessage?.createdAt || x.createdAt));
  res.json({ conversations: list });
});
app.get('/api/admin/conversations/:id', requireUser, requireAdmin, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.params.id, 40));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const online = await onlineIds();
  const allMsgs = await storage.readJson(files.messages, true);
  const cm = allMsgs.filter((m2) => m2.conversationId === c.id).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
  const members = (Array.isArray(c.members) ? c.members : []).map((uid) => safeUser(findUser(uid) || { id: uid, name: 'Deleted user', username: 'deleted', color: '#8b7cf6' }, online));
  res.json({ conversation: { id: c.id, members, lastMessage: cm[0] || null, messageCount: cm.length, createdAt: c.createdAt } });
});
app.get('/api/admin/conversations/:id/messages', requireUser, requireAdmin, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.params.id, 40));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const list = (await storage.readJson(files.messages, true)).filter((m) => m.conversationId === c.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages: list.map((m) => ({ ...m, sender: safeUser(findUser(m.senderId) || { id: m.senderId, name: 'Deleted user', username: 'deleted', color: '#8b7cf6' }) })) });
});
app.put('/api/admin/badge', requireUser, requireAdmin, async (req, res) => {
  const target = findUser(clean(req.body.userId, 30));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (isGod(target)) return res.status(403).json({ error: 'The main admin cannot have their badge changed.' });
  const action = req.body.action === 'revoke' ? 'revoke' : 'grant';
  if (action === 'grant') target.role = 'owner';
  else target.role = target.role === 'owner' ? '' : target.role;
  await storage.writeJson(files.users, users);
  res.json({ ok: true, user: { ...safeUser(target), role: target.role } });
});
app.get('/api/admin/bans', requireUser, requireAdmin, async (req, res) => { res.json({ bans: await bannedList() }); });
app.get('/api/admin/visits', requireUser, requireAdmin, async (req, res) => {
  const v = await storage.readJson(files.visits, true).catch(() => ({}));
  res.json({ total: v.total || 0, today: v.today || 0, day: v.day || null, year: v.year || {}, recent: (v.recent || []).slice(0, 60) });
});
app.put('/api/admin/ban', requireUser, requireAdmin, async (req, res) => {
  const ip = clean(req.body.ip, 45).toLowerCase();
  if (!ip || ip === 'unknown' || ip === '::1') return res.status(400).json({ error: 'Enter a valid IP address.' });
  if (req.user && !isGod(req.user)) {
    try {
      const m = await storage.readJson(files.ipmap, true).catch(() => ({}));
      if (users.some((u) => isGod(u) && m[u.id] && m[u.id].ip === ip)) return res.status(403).json({ error: 'You cannot ban the main admin.' });
    } catch { /* non-fatal */ }
  }
  const b = await bannedList();
  if (b.some((e) => e.ip === ip)) return res.json({ ok: true, already: true, bans: b });
  b.push({ ip, reason: clean(req.body.reason, 200) || 'Banned by admin', by: req.user.username, byName: req.user.name, at: Date.now() });
  await storage.writeJson(files.banned, b);
  banCache = { list: b, at: Date.now() - 2500 };
  res.json({ ok: true, bans: b });
});
app.put('/api/admin/unban', requireUser, requireAdmin, async (req, res) => {
  const ip = clean(req.body.ip, 45).toLowerCase();
  const b = await bannedList();
  const next = b.filter((e) => e.ip !== ip);
  if (next.length !== b.length) { await storage.writeJson(files.banned, next); banCache = { list: next, at: Date.now() - 2500 }; }
  res.json({ ok: true, bans: next });
});

const UPLOAD_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/ogg': '.ogv', 'video/x-m4v': '.m4v', 'video/x-matroska': '.mkv', 'audio/webm': '.weba', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, !!UPLOAD_MIME[file.mimetype]) });
app.post('/api/upload', requireUser, (req, res) => upload.single('image')(req, res, async (err) => {
  if (err || !req.file) return res.status(400).json({ error: 'Please choose an image, video or audio file under 25MB.' });
  try {
    const ext = UPLOAD_MIME[req.file.mimetype] || path.extname(req.file.originalname || '').toLowerCase() || '.bin';
    const url = await storage.writeUpload(`messages/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`, req.file.buffer);
    res.json({ url, mediaType: req.file.mimetype.startsWith('audio/') ? 'audio' : (req.file.mimetype.startsWith('video/') ? 'video' : 'image') });
  } catch (e) { res.status(500).json({ error: 'Upload storage failed.' }); }
}));

/* ---------- profile pictures ---------- */
function sniffImage(buf) {
  const b = buf || Buffer.alloc(0);
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    const d = jpegDims(b);
    return d ? { type: 'image/jpeg', ext: '.jpg', ...d } : null;
  }
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) {
    const d = pngDims(b);
    return d ? { type: 'image/png', ext: '.png', ...d } : null;
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const d = webpDims(b);
    return d ? { type: 'image/webp', ext: '.webp', ...d } : null;
  }
  return null;
}
function pngDims(b) {
  if (b.length < 33) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) return null;
  let off = 8, found = false;
  while (off < b.length - 8) { const len = b.readUInt32BE(off); const c = b.toString('ascii', off + 4, off + 8); if (c === 'IEND') { found = true; break; } if (len > 16777216 || len < 0) break; off += 12 + len; }
  return found ? { width, height } : null;
}
function jpegDims(b) {
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xFF) break;
    const m = b[i + 1];
    if (m === 0xD9) return null; // EOI before SOF
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const seg = b.readUInt16BE(i + 2);
    if (seg < 2 || i + 2 + seg > b.length) break;
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      const height = b.readUInt16BE(i + 5), width = b.readUInt16BE(i + 7);
      if (!width || !height || width > 8192 || height > 8192) return null;
      return b.length >= 3 && b[b.length - 2] === 0xFF && b[b.length - 1] === 0xD9 ? { width, height } : null;
    }
    i += 2 + seg;
  }
  return null;
}
function webpDims(b) {
  let off = 12;
  while (off < b.length && off + 8 <= b.length) {
    const c = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (c === 'VP8X') {
      if (b.length < off + 30) break;
      const width = 1 + b.readUIntLE(off + 12, 3), height = 1 + b.readUIntLE(off + 15, 3);
      return width <= 8192 && height <= 8192 ? { width, height } : null;
    }
    if (c === 'VP8 ') {
      if (b.length < off + 30) break;
      const w = b.readUInt16LE(off + 14), h = b.readUInt16LE(off + 16);
      return w && h && w <= 8192 && h <= 8192 ? { width: w, height: h } : null;
    }
    if (c === 'VP8L') {
      if (b.length < off + 25) break;
      const bits = b.readUIntLE(off + 9, 4);
      const w = (bits & 0x3FFF) + 1, h = ((bits >> 14) & 0x3FFF) + 1;
      return w <= 8192 && h <= 8192 ? { width: w, height: h } : null;
    }
    if (c === 'ANMF' || c === 'ANIM' || c === 'ALPH' || c === 'ICCP' || c === 'EXIF' || c === 'XMP ') { off += 8 + size; continue; }
    break;
  }
  return null;
}
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });
app.post('/api/avatar', requireUser, (req, res) => avatarUpload.single('image')(req, res, async (err) => {
  if (err || !req.file || req.file.size < 16) return res.status(400).json({ error: 'Please choose a profile picture (JPG, PNG or WebP) under 3MB.' });
  const info = sniffImage(req.file.buffer);
  if (!info) return res.status(400).json({ error: 'That file is not a valid image (JPG, PNG or WebP only).' });
  if (info.width > 1024 || info.height > 1024) return res.status(400).json({ error: 'Image is too large. Please use a picture up to 1024px.' });
  try {
    const rel = `avatars/${req.user.id}-${crypto.randomBytes(5).toString('hex')}${info.ext}`;
    const url = await storage.writeUpload(rel, req.file.buffer);
    req.user.avatar = url;
    await storage.writeJson(files.users, users);
    res.json({ user: safeUser(req.user, await onlineIds()) });
  } catch (e) { res.status(500).json({ error: 'Profile picture upload failed.' }); }
}));
app.post('/api/avatar/remove', requireUser, async (req, res) => {
  req.user.avatar = '';
  await storage.writeJson(files.users, users);
  res.json({ user: safeUser(req.user, await onlineIds()) });
});

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.weba': 'audio/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
app.get('/uploads/*', async (req, res) => {
  const rel = clean(req.params[0] || '', 300);
  if (!rel) return res.status(404).end();
  try {
    const buf = await storage.readUpload(rel);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
    if (m && (m[1] || m[2])) {
      const total = buf.length;
      let start = m[1] === '' ? total - Number(m[2]) : Number(m[1]);
      let end = (m[1] === '' || m[2] === '') ? total - 1 : Number(m[2]);
      start = Math.max(0, Math.min(start, total - 1));
      end = Math.max(start, Math.min(end, total - 1));
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', end - start + 1);
      return res.end(buf.slice(start, end + 1));
    }
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch { res.status(404).end(); }
});

app.use((req, res, next) => { if (req.method === 'GET' && !req.path.startsWith('/api') && !/\.\w{1,5}$/.test(req.path)) recordVisit(req).catch(() => {}); next(); });
/* ---------- landing page at /, app shell at /app ---------- */
app.get('/', (req, res, next) => {
  if (req.query && req.query.code) {
    const qs = req.originalUrl.indexOf('?') >= 0 ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect('/auth/callback' + qs);
  }
  next();
});
app.use(express.static(PUBLIC, { setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=300') }));
app.get('*', async (req, res) => { res.sendFile(path.join(PUBLIC, 'app', 'index.html')); });

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`NexChat listening on http://0.0.0.0:${PORT}  [storage:${storage.mode}]`));
}

module.exports = app;