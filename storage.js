const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const repo = process.env.GITHUB_STORAGE_REPO || '';
const token = process.env.GITHUB_TOKEN || '';
const branch = process.env.GITHUB_STORAGE_BRANCH || 'main';
const mode = repo && token ? 'api' : 'local';

const apiUrl = (p) => `https://api.github.com/repos/${repo}/contents/${p}?ref=${branch}`;
const HEADERS = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nexchat' };

const localData = () => path.join(ROOT, 'data');
const localUploads = () => path.join(ROOT, 'uploads');

let readCache = new Map();
function cached(object, p) {
  const now = Date.now();
  if (readCache.has(p) && now - readCache.get(p).ts < 750) return readCache.get(p).data;
  readCache.set(p, { data: object, ts: now });
  return object;
}

async function apiGet(p) {
  const res = await fetch(apiUrl(p), { headers: HEADERS });
  if (res.status === 404) return null;
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub rate limit exceeded');
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json();
}

async function apiPut(p, contentBase64, sha) {
  const body = { message: `nexchat: sync ${p}`, content: contentBase64, branch };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${p}`, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
  return res.json();
}

let writeQueue = Promise.resolve();
function serialized(fn) { const next = writeQueue.then(fn, fn); writeQueue = next.catch(() => {}); return next; }

const enabled = mode === 'api';
const dataDir = mode === 'api' ? path.join(ROOT, 'data') : path.join(ROOT, 'data');
const uploadsDir = mode === 'api' ? path.join(ROOT, 'uploads') : path.join(ROOT, 'uploads');

function ensure() {
  if (mode === 'api') return;
  for (const dir of [dataDir, uploadsDir, path.join(uploadsDir, 'avatars'), path.join(uploadsDir, 'messages'), path.join(uploadsDir, 'covers')]) fs.mkdirSync(dir, { recursive: true });
}

const toB64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const fromB64 = (s) => Buffer.from(s, 'base64').toString('utf8');

async function readJson(name) {
  if (mode === 'api') {
    return cached((async () => {
      const j = await apiGet(name);
      if (!j) return [];
      try { return JSON.parse(fromB64(j.content)); } catch { return []; }
    })(), `json:${name}`);
  }
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8') || '[]'); } catch { return []; }
}

async function writeJson(name, value) {
  const raw = JSON.stringify(value, null, 2);
  if (mode === 'api') return serialized(async () => {
    let sha = null;
    const existing = await apiGet(name).catch(() => null);
    if (existing) sha = existing.sha;
    try { await apiPut(name, toB64(raw), sha); }
    catch (err) {
      if (/422|409/.test(String(err.message))) {
        const retry = await apiGet(name).catch(() => null);
        await apiPut(name, toB64(raw), retry ? retry.sha : undefined);
      } else throw err;
    }
    readCache.delete(`json:${name}`);
  });
  fs.writeFileSync(path.join(dataDir, name), raw);
}

async function readUpload(relPath) {
  if (mode === 'api') {
    const j = await apiGet(`uploads/${relPath}`);
    if (!j) return null;
    return Buffer.from(j.content, 'base64');
  }
  const p = path.join(uploadsDir, relPath);
  if (!p.startsWith(uploadsDir)) return null;
  try { return fs.readFileSync(p); } catch { return null; }
}

async function writeUpload(name, buffer) {
  const rel = sanitize(name);
  if (mode === 'api') {
    return serialized(async () => {
      let sha = null;
      const existing = await apiGet(`uploads/${rel}`).catch(() => null);
      if (existing) sha = existing.sha;
      try { await apiPut(`uploads/${rel}`, buffer.toString('base64'), sha); }
      catch (err) {
        if (/422|409/.test(String(err.message))) {
          const retry = await apiGet(`uploads/${rel}`).catch(() => null);
          await apiPut(`uploads/${rel}`, buffer.toString('base64'), retry ? retry.sha : undefined);
        } else throw err;
      }
    }).then(() => `/uploads/${rel}`);
  }
  const p = path.join(uploadsDir, rel);
  if (!p.startsWith(uploadsDir)) throw new Error('Invalid upload path');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
  return `/uploads/${rel}`;
}

function sanitize(name) {
  return String(name || '').replace(/^[/\\]+/, '').replace(/[\\/]/g, '/').split('/').map(x => x.replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean).join('/');
}

module.exports = { mode, enabled, dataDir, uploadsDir, ensure, readJson, writeJson, readUpload, writeUpload };