const { execFile, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const repo = process.env.GITHUB_STORAGE_REPO || '';
const token = process.env.GITHUB_TOKEN || '';
const branch = process.env.GITHUB_STORAGE_BRANCH || 'main';
const commitUser = process.env.GITHUB_DATA_USER || 'nexchat-storage';
const commitEmail = process.env.GITHUB_DATA_EMAIL || 'nexchat-storage@users.noreply.github.com';
const remote = process.env.GITHUB_STORAGE_URL || (repo && token ? `https://github.com/${repo}.git` : '');

const enabled = !!(repo && token && remote);
const baseDir = enabled ? path.join(ROOT, 'storage') : ROOT;
const dataDir = path.join(baseDir, 'data');
const uploadsDir = path.join(baseDir, 'uploads');
const authArg = `http.extraheader=AUTHORIZATION: bearer ${token}`;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim()));
      else resolve(stdout.toString());
    });
  });
}

function runSync(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'git failed').trim());
  return r.stdout;
}

function authArgs(extra = []) { return ['-c', authArg, ...extra]; }

function ensure() {
  if (!enabled) return;
  fs.mkdirSync(baseDir, { recursive: true });
  if (fs.existsSync(path.join(baseDir, '.git'))) {
    const local = runSync(['-C', baseDir, 'status', '--porcelain']).trim();
    if (local) {
      runSync(['-C', baseDir, 'add', '-A']);
      runSync(['-C', baseDir, 'commit', '-m', `storage sync ${new Date().toISOString()}`]);
      try { runSync(authArgs(['-C', baseDir, 'push', 'origin', `HEAD:${branch}`])); } catch (err) { console.error('Storage push on boot failed:', err.message); }
    }
    runSync(authArgs(['-C', baseDir, 'pull', '--ff-only', 'origin', branch]));
  } else {
    const leftover = fs.readdirSync(baseDir).filter(x => x !== '.' && x !== '..');
    if (leftover.length) {
      fs.renameSync(baseDir, path.join(ROOT, `storage-stash-${Date.now()}`));
      fs.mkdirSync(baseDir, { recursive: true });
    }
    runSync(authArgs(['clone', '--branch', branch, remote, baseDir]));
  }
  runSync(['-C', baseDir, 'config', 'pull.rebase', 'false']);
  runSync(['-C', baseDir, 'config', 'user.name', commitUser]);
  runSync(['-C', baseDir, 'config', 'user.email', commitEmail]);
}

let timer = null;
let dirty = false;
function sync() {
  if (!enabled) return;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(doSync, 1500);
}

async function doSync() {
  if (!enabled || !dirty) return;
  dirty = false;
  try {
    await run(authArgs(['-C', baseDir, 'add', '-A']));
    const status = await run(['-C', baseDir, 'status', '--porcelain']);
    if (!status.trim()) return;
    await run(['-C', baseDir, 'commit', '-m', `storage sync ${new Date().toISOString()}`]);
    await run(authArgs(['-C', baseDir, 'pull', '--rebase', 'origin', branch]));
    await run(authArgs(['-C', baseDir, 'push', 'origin', `HEAD:${branch}`]));
  } catch (err) {
    dirty = true;
    console.error('Storage sync failed:', err.message);
  }
}

function flush() { if (dirty && enabled) { clearTimeout(timer); return doSync(); } return Promise.resolve(); }
process.on('SIGINT', () => flush().then(() => process.exit(0), () => process.exit(0)));
process.on('SIGTERM', () => flush().then(() => process.exit(0), () => process.exit(0)));

module.exports = { enabled, dataDir, uploadsDir, ensure, sync };