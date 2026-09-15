const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');
const storage = require('./storage');

const ROOT = __dirname;
const DATA = storage.dataDir;
const UPLOADS = storage.uploadsDir;
const PUBLIC = path.join(ROOT, 'public');
const files = { users: path.join(DATA, 'users.json'), conversations: path.join(DATA, 'conversations.json'), messages: path.join(DATA, 'messages.json') };
storage.ensure();
for (const folder of [DATA, UPLOADS, path.join(UPLOADS, 'avatars'), path.join(UPLOADS, 'messages'), path.join(UPLOADS, 'covers'), PUBLIC, path.join(PUBLIC, 'assets')]) fs.mkdirSync(folder, { recursive: true });
for (const file of Object.values(files)) if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');

function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch { return []; } }
let writeQueue = Promise.resolve();
function writeJSON(file, value) { writeQueue = writeQueue.then(() => fs.promises.writeFile(file, JSON.stringify(value, null, 2))); writeQueue.then(() => storage.sync()).catch(() => {}); return writeQueue; }
const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const memberId = () => `NC-${crypto.randomInt(100000, 999999)}`;
const clean = (value, max = 5000) => String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const safeUser = (u, onlineIds = new Set()) => ({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio, color: u.color, createdAt: u.createdAt, online: onlineIds.has(u.id) });

let users = readJSON(files.users), conversations = readJSON(files.conversations), messages = readJSON(files.messages);
const demoNames = ['Ahmed', 'Mohamed', 'Sara', 'Youssef'];
if (!users.length) {
  users = demoNames.map((username, i) => ({ id: memberId(), username, password: 'password', avatar: '', bio: ['Product designer & coffee enthusiast.', 'Building quietly, learning loudly.', 'Creative soul. Say hello!', 'Always up for a good conversation.'][i], color: ['#8b7cf6', '#32c5d2', '#ff8a65', '#65d38a'][i], createdAt: new Date().toISOString() }));
  writeJSON(files.users, users);
}
const sessions = new Map();
const online = new Map();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(PUBLIC));

function currentUser(req) { const token = req.headers.cookie?.match(/nexchat_session=([^;]+)/)?.[1]; return sessions.get(token) || null; }
function requireUser(req, res, next) { const user = currentUser(req); if (!user) return res.status(401).json({ error: 'Unauthorized' }); req.user = user; next(); }
function findUser(userId) { return users.find(u => u.id === userId); }
function conversationFor(a, b) { return conversations.find(c => c.members.includes(a) && c.members.includes(b)); }
function hydrateConversation(c, userId) { const otherId = c.members.find(m => m !== userId); const convMessages = messages.filter(m => m.conversationId === c.id); return { ...c, other: safeUser(findUser(otherId) || { id: otherId, username: 'Unknown', color: '#8b7cf6' }, new Set(online.keys())), lastMessage: convMessages.sort((x,y) => new Date(y.createdAt)-new Date(x.createdAt))[0] || null, unread: convMessages.filter(m => m.senderId !== userId && m.status !== 'read').length }; }

app.post('/api/register', async (req, res) => {
  const username = clean(req.body.username, 32), password = String(req.body.password || '');
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Username must be 3+ characters and password 4+ characters.' });
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  let uid; do uid = memberId(); while (findUser(uid));
  const user = { id: uid, username, password, avatar: '', bio: 'New to NexChat.', color: ['#8b7cf6','#32c5d2','#ff8a65','#65d38a','#e68bd1'][users.length % 5], createdAt: new Date().toISOString() };
  users.push(user); await writeJSON(files.users, users); res.json({ user: safeUser(user) });
});
app.post('/api/login', (req, res) => { const user = users.find(u => u.username.toLowerCase() === String(req.body.username || '').toLowerCase() && u.password === String(req.body.password || '')); if (!user) return res.status(401).json({ error: 'Invalid username or password.' }); const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, user.id); res.setHeader('Set-Cookie', `nexchat_session=${token}; HttpOnly; SameSite=Lax; Path=/`); res.json({ user: safeUser(user, new Set(online.keys())) }); });
app.post('/api/logout', requireUser, (req, res) => { const token = req.headers.cookie?.match(/nexchat_session=([^;]+)/)?.[1]; sessions.delete(token); online.delete(req.user.id); io.emit('presence', { userId: req.user, online: false }); res.setHeader('Set-Cookie', 'nexchat_session=; Max-Age=0; Path=/'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { const u = currentUser(req); res.json({ user: u ? safeUser(findUser(u), new Set(online.keys())) : null }); });
app.get('/api/users/:id', requireUser, (req, res) => { const u = findUser(clean(req.params.id, 30)); if (!u) return res.status(404).json({ error: 'User not found.' }); res.json({ user: safeUser(u, new Set(online.keys())) }); });
app.get('/api/users', requireUser, (req, res) => { const q = String(req.query.q || '').toLowerCase(); res.json({ users: users.filter(u => u.id !== req.user && (!q || u.username.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))).slice(0, 20).map(u => safeUser(u, new Set(online.keys()))) }); });
app.put('/api/profile', requireUser, async (req, res) => { const u = findUser(req.user); const username = clean(req.body.username || u.username, 32); if (users.some(x => x.id !== u.id && x.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' }); u.username = username; u.bio = clean(req.body.bio ?? u.bio, 160); if (req.body.color) u.color = /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : u.color; await writeJSON(files.users, users); res.json({ user: safeUser(u, new Set(online.keys())) }); });
app.get('/api/conversations', requireUser, (req, res) => res.json({ conversations: conversations.filter(c => c.members.includes(req.user)).map(c => hydrateConversation(c, req.user)).sort((a,b) => new Date(b.lastMessage?.createdAt || b.createdAt)-new Date(a.lastMessage?.createdAt || a.createdAt)) }));
app.post('/api/conversations', requireUser, async (req, res) => { const other = findUser(clean(req.body.memberId, 30)); if (!other || other.id === req.user) return res.status(404).json({ error: other ? 'You cannot message yourself.' : 'No user found with this ID.' }); let c = conversationFor(req.user, other.id); if (!c) { c = { id: id('conv'), members: [req.user, other.id], createdAt: new Date().toISOString(), theme: { background: '', color: '#8b7cf6' } }; conversations.push(c); await writeJSON(files.conversations, conversations); } res.json({ conversation: hydrateConversation(c, req.user) }); });
app.get('/api/messages/:conversationId', requireUser, (req, res) => { const c = conversations.find(x => x.id === req.params.conversationId && x.members.includes(req.user)); if (!c) return res.status(404).json({ error: 'Conversation not found.' }); res.json({ messages: messages.filter(m => m.conversationId === c.id).map(m => ({ ...m, sender: safeUser(findUser(m.senderId) || { id: m.senderId, username: 'Unknown', color: '#8b7cf6' }, new Set(online.keys())) })) }); });
app.put('/api/conversations/:id/theme', requireUser, async (req, res) => { const c = conversations.find(x => x.id === req.params.id && x.members.includes(req.user)); if (!c) return res.status(404).json({ error: 'Conversation not found.' }); c.theme = { background: clean(req.body.background, 500), color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : c.theme.color }; await writeJSON(files.conversations, conversations); io.to(c.id).emit('theme', c.theme); res.json({ theme: c.theme }); });
const upload = multer({ storage: multer.diskStorage({ destination: path.join(UPLOADS, 'messages'), filename: (_, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(null, /^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype)) });
app.post('/api/upload', requireUser, (req, res) => upload.single('image')(req, res, err => { if (err || !req.file) return res.status(400).json({ error: 'Please choose an image under 5MB.' }); storage.sync(); res.json({ url: `/uploads/messages/${req.file.filename}` }); }));

io.use((socket, next) => { const cookie = socket.handshake.headers.cookie?.match(/nexchat_session=([^;]+)/)?.[1]; const uid = sessions.get(cookie); if (!uid) return next(new Error('Unauthorized')); socket.userId = uid; next(); });
io.on('connection', socket => {
  online.set(socket.userId, socket.id); socket.join('user:' + socket.userId);
  io.emit('presence', { userId: socket.userId, online: true });
  socket.on('join', convId => { const c = conversations.find(x => x.id === convId && x.members.includes(socket.userId)); if (c) socket.join(convId); });
  socket.on('typing', ({ conversationId, isTyping }) => { const c = conversations.find(x => x.id === conversationId && x.members.includes(socket.userId)); const u = findUser(socket.userId); if (c && u) socket.to(conversationId).emit('typing', { user: safeUser(u, new Set(online.keys())), isTyping: !!isTyping }); });
  socket.on('message', async ({ conversationId, type = 'text', content }) => {
    const c = conversations.find(x => x.id === conversationId && x.members.includes(socket.userId));
    const text = type === 'image' ? clean(content, 500) : clean(content, 2000);
    if (!c || !text) return;
    const otherId = c.members.find(m => m !== socket.userId);
    const otherOnline = online.has(otherId);
    const message = { id: id('msg'), conversationId, senderId: socket.userId, type: type === 'image' ? 'image' : 'text', content: text, status: otherOnline ? 'delivered' : 'sent', createdAt: new Date().toISOString() };
    messages.push(message); await writeJSON(files.messages, messages);
    const payload = { ...message, sender: safeUser(findUser(socket.userId), new Set(online.keys())) };
    io.to('user:' + socket.userId).emit('message', payload);
    io.to('user:' + otherId).emit('message', payload);
    if (otherOnline) io.to('user:' + otherId).emit('delivered', { conversationId, messageId: message.id });
  });
  socket.on('read', async ({ conversationId }) => {
    const c = conversations.find(x => x.id === conversationId && x.members.includes(socket.userId));
    if (!c) return;
    let changed = 0;
    for (const m of messages) { if (m.conversationId === c.id && m.senderId !== socket.userId && m.status !== 'read') { m.status = 'read'; changed++; } }
    if (changed) await writeJSON(files.messages, messages);
    for (const member of c.members) io.to('user:' + member).emit('read', { conversationId: c.id, userId: socket.userId });
    io.to(c.id).emit('read', { conversationId: c.id, userId: socket.userId });
  });
  socket.on('disconnect', () => { if (online.get(socket.userId) === socket.id) { online.delete(socket.userId); io.emit('presence', { userId: socket.userId, online: false }); } });
});
app.get('*', (_, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`NexChat listening on http://0.0.0.0:${PORT}`));
