const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const repo = process.env.GITHUB_STORAGE_REPO || '';
const token = process.env.GITHUB_TOKEN || '';
const branch = process.env.GITHUB_STORAGE_BRANCH || 'main';

const r2 = {
  account: process.env.R2_ACCOUNT_ID || '',
  bucket: process.env.R2_BUCKET || '',
  accessKey: process.env.R2_ACCESS_KEY_ID || '',
  secretKey: process.env.R2_SECRET_ACCESS_KEY || ''
};

const mode = (r2.account && r2.bucket && r2.accessKey && r2.secretKey) ? 'r2' : (repo && token ? 'api' : 'local');

const apiUrl = (p) => `https://api.github.com/repos/${repo}/contents/${p}?ref=${branch}`;
const HEADERS = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nexchat' };

const localData = () => path.join(ROOT, 'data');
const localUploads = () => path.join(ROOT, 'uploads');

const PHYSICAL = {
  'users.json': 'db.json', 'conversations.json': 'db.json', 'messages.json': 'db.json',
  'presence.json': 'live.json', 'typing.json': 'live.json'
};
const TTL = { 'db.json': 9000, 'live.json': 15000 };

let cache = new Map();
let inflight = new Map();

/* ---------- Cloudflare R2 (S3-compatible, SigV4) ---------- */
const sha256hex = (data) => crypto.createHash('sha256').update(data || '').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function sign(method, key, body) {
  const host = `${r2.bucket}.${r2.account}.r2.cloudflarestorage.com`;
  const payloadHash = sha256hex(body);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto', service = 's3';
  const canonicalUri = '/' + key.split('/').map(encodeURIComponent).join('/');
  const signedHeaders = 'host;x-amz-content-sha256';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\n`;
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
  const kDate = hmac(Buffer.from('AWS4' + r2.secretKey, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  return {
    url: `https://${host}/${key.split('/').map(encodeURIComponent).join('/')}`,
    auth: `AWS4-HMAC-SHA256 Credential=${r2.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    payloadHash, amzDate
  };
}

async function r2Request(method, key, body) {
  const s = sign(method, key, body);
  const headers = { 'x-amz-content-sha256': s.payloadHash, 'x-amz-date': s.amzDate, 'authorization': s.auth };
  if (body) headers['content-length'] = String(body.byteLength || body.length);
  return fetch(s.url, { method, headers, body: body || undefined });
}

async function r2ReadText(key) {
  const res = await r2Request('GET', key, '');
  if (res.status === 404) return null;
  if (!res.ok) { const err = new Error(`R2 read failed (${res.status})`); err.r2 = res.status; throw err; }
  return Buffer.from(await res.arrayBuffer());
}

async function r2Write(key, buffer) {
  const res = await r2Request('PUT', key, buffer || Buffer.alloc(0));
  if (!res.ok) { const err = new Error(`R2 write failed (${res.status})`); err.r2 = res.status; throw err; }
  return res;
}

/* ---------- GitHub Contents API (legacy) ---------- */
async function apiGet(p) {
  const res = await fetch(apiUrl(p), { headers: HEADERS });
  if (res.status === 404) return null;
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const err = new Error('GitHub rate limit exceeded');
    err.rateLimited = 'read';
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  return res.json();
}

async function apiPut(p, contentBase64, sha) {
  const body = { message: `nexchat: sync ${p}`, content: contentBase64, branch };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${p}`, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const err = new Error('GitHub rate limit exceeded');
    err.rateLimited = 'write';
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
  return res.json();
}

let writeQueue = Promise.resolve();
function serialized(fn) { const next = writeQueue.then(fn, fn); writeQueue = next.catch(() => {}); return next; }

const enabled = mode !== 'local';
const dataDir = path.join(ROOT, 'data');
const uploadsDir = path.join(ROOT, 'uploads');

function ensure() {
  if (mode !== 'local') return;
  for (const dir of [dataDir, uploadsDir, path.join(uploadsDir, 'avatars'), path.join(uploadsDir, 'messages'), path.join(uploadsDir, 'covers')]) fs.mkdirSync(dir, { recursive: true });
}

const toB64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const fromB64 = (s) => Buffer.from(s, 'base64').toString('utf8');

const physical = (name) => PHYSICAL[name] || name;
const ttl = (p) => (TTL[p] != null ? TTL[p] : 9000);

function cacheGet(p) {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.ts < ttl(p)) return hit;
  return null;
}

async function fetchRaw(p) {
  if (mode === 'r2') {
    const buf = await r2ReadText(p);
    if (!buf) return [];
    try { return JSON.parse(buf.toString('utf8')); } catch { return []; }
  }
  const j = await apiGet(p);
  if (!j) return [];
  try { return JSON.parse(fromB64(j.content)); } catch { return []; }
}

async function readJson(name) {
  const p = physical(name);
  if (mode === 'r2' || mode === 'api') {
    const hit = cacheGet(p);
    if (hit) return hit.data;
    if (inflight.has(p)) return inflight.get(p);
    const task = (async () => {
      let value;
      try {
        value = await fetchRaw(p);
        cache.set(p, { data: value, ts: Date.now() });
      } catch (err) {
        const stale = cache.get(p);
        if (stale) {
          cache.set(p, { data: stale.data, ts: Date.now() });
          return stale.data;
        }
        throw err;
      }
      return value;
    })().finally(() => inflight.delete(p));
    inflight.set(p, task);
    return task;
  }
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8') || '[]'); } catch { return []; }
}

async function writeJson(name, value) {
  const p = physical(name);
  const raw = JSON.stringify(value, null, 2);
  if (mode === 'r2') return serialized(async () => {
    await r2Write(p, Buffer.from(raw, 'utf8'));
    cache.set(p, { data: value, ts: Date.now() });
  });
  if (mode === 'api') return serialized(async () => {
    let sha = null;
    const existing = await apiGet(p).catch(() => null);
    if (existing) sha = existing.sha;
    try { await apiPut(p, toB64(raw), sha); }
    catch (err) {
      if (/422|409/.test(String(err.message))) {
        const retry = await apiGet(p).catch(() => null);
        await apiPut(p, toB64(raw), retry ? retry.sha : undefined);
      } else throw err;
    }
    cache.set(p, { data: value, ts: Date.now() });
  });
  fs.writeFileSync(path.join(dataDir, name), raw);
}

async function readUpload(relPath) {
  const rel = sanitize(relPath);
  if (mode === 'r2') {
    const buf = await r2ReadText(`uploads/${rel}`);
    return buf || null;
  }
  if (mode === 'api') {
    const j = await apiGet(`uploads/${rel}`);
    if (!j) return null;
    return Buffer.from(j.content, 'base64');
  }
  const p = path.join(uploadsDir, relPath);
  if (!p.startsWith(uploadsDir)) return null;
  try { return fs.readFileSync(p); } catch { return null; }
}

async function writeUpload(name, buffer) {
  const rel = sanitize(name);
  if (mode === 'r2') {
    await serialized(() => r2Write(`uploads/${rel}`, buffer).then(() => {}));
    return `/uploads/${rel}`;
  }
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