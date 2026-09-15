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
const files = { users: 'users.json', conversations: 'conversations.json', messages: 'messages.json', presence: 'presence.json', typing: 'typing.json' };
const SECRET = process.env.SESSION_SECRET || 'nexchat-dev-secret-change-me';
const AUTH_BYPASS = process.env.AUTH_BYPASS === '1';
const DEMO_AUTO = 'NC-482913';

storage.ensure();
const demoUsers = [
  { id: 'NC-482913', name: 'Ahmed', username: 'ahmed', password: 'password', avatar: '', bio: 'Product designer & coffee enthusiast.', color: '#8b7cf6', createdAt: new Date().toISOString() },
  { id: 'NC-735192', name: 'Mohamed', username: 'medo', password: 'password', avatar: '', bio: 'Building quietly, learning loudly.', color: '#32c5d2', createdAt: new Date().toISOString() },
  { id: 'NC-918624', name: 'Sara', username: 'sara', password: 'password', avatar: '', bio: 'Creative soul. Say hello!', color: '#ff8a65', createdAt: new Date().toISOString() },
  { id: 'NC-204817', name: 'Youssef', username: 'youssef', password: 'password', avatar: '', bio: 'Always up for a good conversation.', color: '#65d38a', createdAt: new Date().toISOString() }
];

const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const memberId = () => `NC-${crypto.randomInt(100000, 999999)}`;
const clean = (value, max = 5000) => String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const safeUser = (u, onlineIds = new Set()) => ({ id: u.id, name: u.name || u.username, username: u.username, avatar: u.avatar, bio: u.bio, color: u.color, createdAt: u.createdAt, online: onlineIds.has(u.id) });

let seedPromise = null;
async function seed() {
  const users = await storage.readJson(files.users);
  if (users && users.length) return;
  await storage.writeJson(files.users, demoUsers);
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
const cookieToken = (req) => req.headers.cookie?.match(/(?:^|;)\s*nexchat_session=([^;]+)/)?.[1] || '';
const currentUser = (req) => { const o = verify(cookieToken(req)); return o ? o.uid : null; };

async function onlineIds() {
  const p = await storage.readJson(files.presence).catch(() => ({}));
  const now = Date.now();
  return new Set(Object.entries(p).filter(([, t]) => now - t < 150000).map(([uid]) => uid));
}
async function markOnline(uid) {
  const p = await storage.readJson(files.presence).catch(() => ({}));
  if (nowAgo(p[uid]) < 15000) return;
  p[uid] = Date.now();
  await storage.writeJson(files.presence, p);
}
const nowAgo = (t) => (t ? Date.now() - t : Infinity);
async function hydrateConversation(c, userId, online, typing) {
  const otherId = c.members.find((m) => m !== userId);
  const convMessages = (await storage.readJson(files.messages)).filter((m) => m.conversationId === c.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  let typ = null;
  const te = typing && typing[c.id];
  if (te && te.userId !== userId && te.userId === otherId && nowAgo(te.at) < 8000) {
    const tu = users.find((x) => x.id === te.userId);
    if (tu) typ = { user: safeUser(tu, online), isTyping: true };
  }
  return { ...c, other: safeUser(findUser(otherId) || { id: otherId, name: 'Unknown', username: 'Unknown', color: '#8b7cf6' }, online), lastMessage: convMessages[0] || null, unread: convMessages.filter((m) => m.senderId !== userId && m.status !== 'read').length, typing: typ };
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
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
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

app.post('/api/register', async (req, res) => {
  if (AUTH_BYPASS) return res.status(403).json({ error: 'Registration is temporarily disabled.' });
  const username = clean(req.body.username, 32), password = String(req.body.password || '');
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Username must be 3+ characters and password 4+ characters.' });
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  let uid; do uid = memberId(); while (findUser(uid));
  const name = clean(req.body.name, 40) || username;
  const user = { id: uid, name, username, password, avatar: '', bio: 'New to NexChat.', color: ['#8b7cf6', '#32c5d2', '#ff8a65', '#65d38a', '#e68bd1'][users.length % 5], createdAt: new Date().toISOString() };
  users.push(user);
  await storage.writeJson(files.users, users);
  const token = sign({ uid: user.id });
  setCookie(res, token);
  await markOnline(user.id);
  res.json({ user: safeUser(user, await onlineIds()) });
});
app.post('/api/login', async (req, res) => {
  let user = users.find((u) => u.username.toLowerCase() === String(req.body.username || '').toLowerCase() && u.password === String(req.body.password || ''));
  if (!user && AUTH_BYPASS) user = findUser(DEMO_AUTO) || demoUsers[0] || null;
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
  const token = sign({ uid: user.id });
  setCookie(res, token);
  await markOnline(user.id);
  res.json({ user: safeUser(user, await onlineIds()) });
});
app.post('/api/logout', requireUser, async (req, res) => {
  setCookie(res, '', false);
  const p = await storage.readJson(files.presence).catch(() => ({}));
  if (p[req.uid]) { p[req.uid] = 0; await storage.writeJson(files.presence, p); }
  res.json({ ok: true });
});
app.get('/api/me', async (req, res) => { const uid = currentUser(req) || (AUTH_BYPASS ? DEMO_AUTO : null); const u = findUser(uid) || (uid && AUTH_BYPASS ? demoUsers[0] : null); res.json({ user: u ? safeUser(u, await onlineIds()) : null }); });
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
  if (!c) { c = { id: id('conv'), members: [req.uid, other.id], createdAt: new Date().toISOString(), theme: { background: '', color: '#8b7cf6' } }; conversations.push(c); await storage.writeJson(files.conversations, conversations); }
  res.json({ conversation: await hydrateConversation(c, req.uid, await onlineIds(), await storage.readJson(files.typing, true).catch(() => ({}))) });
});
app.get('/api/messages/:conversationId', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === req.params.conversationId && x.members.includes(req.uid));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  const since = clean(req.query.laterThan, 60);
  const list = (await storage.readJson(files.messages)).filter((m) => m.conversationId === c.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).filter((m) => !since || (m.createdAt && m.createdAt > since));
  res.json({ messages: list.map((m) => ({ ...m, sender: safeUser(findUser(m.senderId) || { id: m.senderId, username: 'Unknown', color: '#8b7cf6' }) })), members: c.members });
});
app.post('/api/messages', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === clean(req.body.conversationId, 40) && x.members.includes(req.uid));
  const text = clean(req.body.content || '', req.body.type === 'image' ? 500 : 2000);
  if (!c || !text) return res.status(400).json({ error: 'Cannot send an empty message.' });
  const otherId = c.members.find((m) => m !== req.uid);
  const now = await onlineIds();
  const message = { id: id('msg'), conversationId: c.id, senderId: req.uid, type: req.body.type === 'image' ? 'image' : 'text', content: text, status: now.has(otherId) ? 'delivered' : 'sent', createdAt: new Date().toISOString() };
  messages.push(message);
  await storage.writeJson(files.messages, messages);
  res.json({ message: { ...message, sender: safeUser(req.user) } });
});
app.post('/api/messages/:conversationId/read', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === req.params.conversationId && x.members.includes(req.uid));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  let changed = false;
  for (const m of messages) { if (m.conversationId === c.id && m.senderId !== req.uid && m.status !== 'read') { m.status = 'read'; changed = true; } }
  if (changed) await storage.writeJson(files.messages, messages);
  res.json({ ok: true });
});
app.put('/api/conversations/:id/theme', requireUser, async (req, res) => {
  const c = conversations.find((x) => x.id === req.params.id && x.members.includes(req.uid));
  if (!c) return res.status(404).json({ error: 'Conversation not found.' });
  c.theme = { background: clean(req.body.background, 500), color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : c.theme.color };
  await storage.writeJson(files.conversations, conversations);
  res.json({ theme: c.theme });
});
app.post('/api/presence', requireUser, async (req, res) => { await markOnline(req.uid); res.json({ ok: true }); });
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype)) });
app.post('/api/upload', requireUser, (req, res) => upload.single('image')(req, res, async (err) => {
  if (err || !req.file) return res.status(400).json({ error: 'Please choose an image under 5MB.' });
  try {
    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
    const url = await storage.writeUpload(`messages/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`, req.file.buffer);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: 'Image storage failed.' }); }
}));

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
app.get('/uploads/*', async (req, res) => {
  const rel = clean(req.params[0] || '', 300);
  if (!rel) return res.status(404).end();
  try {
    const buf = await storage.readUpload(rel);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch { res.status(404).end(); }
});

app.use(express.static(PUBLIC));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`NexChat listening on http://0.0.0.0:${PORT}  [storage:${storage.mode}]`));
}

module.exports = app;