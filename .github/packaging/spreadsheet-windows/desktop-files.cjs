/**
 * The workbooks Windows opened with this app. The page reads and writes them
 * through the loopback server, by a token issued here, and never by a path it
 * could choose itself.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isSpreadsheetName } = require('./open-file.cjs');

const MAX_BYTES = 512 * 1024 * 1024;

function samePath(a, b) {
  const left = path.normalize(a);
  const right = path.normalize(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function safeBase(name) {
  const base = String(name || '').replace(/\.xlsx$/i, '').trim();
  if (!base || base.length > 180) return null;
  if (/[\\/:*?"<>|\u0000]/.test(base)) return null;
  if (base === '.' || base === '..') return null;
  return base;
}

function createDesktopFiles() {
  const files = new Map();
  let launch = null;

  function add(filePath, { asLaunch = false } = {}) {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    const real = fs.realpathSync(resolved);
    const name = path.basename(real);
    if (!isSpreadsheetName(name)) return null;
    const token = crypto.randomBytes(16).toString('hex');
    const entry = {
      path: real,
      writable: name.toLowerCase().endsWith('.xlsx'),
      mtime: stat.mtimeMs,
      size: stat.size,
    };
    files.set(token, entry);
    const info = { token, name, writable: entry.writable };
    if (asLaunch) launch = info;
    return info;
  }

  function refresh(entry) {
    const stat = fs.statSync(entry.path);
    entry.mtime = stat.mtimeMs;
    entry.size = stat.size;
  }

  function send(res, status, body) {
    if (res.writableEnded) return;
    res.writeHead(status);
    res.end(body);
  }

  function read(entry, req, res) {
    fs.readFile(entry.path, (err, data) => {
      if (err) { send(res, 404); return; }
      try { refresh(entry); } catch { /* the bytes already read are the answer */ }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  function write(entry, req, res, force) {
    if (!entry.writable) { send(res, 405); return; }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { tooBig = true; req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', () => send(res, tooBig ? 413 : 400));
    req.on('end', () => {
      if (tooBig || res.writableEnded) return;
      let current;
      try { current = fs.realpathSync(entry.path); } catch { current = null; }
      if (!current || !samePath(current, entry.path)) { send(res, 409); return; }
      if (!force) {
        try {
          const stat = fs.statSync(entry.path);
          if (entry.mtime != null && stat.mtimeMs > entry.mtime + 1000) {
            send(res, 409);
            return;
          }
        } catch {
          send(res, 409);
          return;
        }
      }
      fs.writeFile(entry.path, Buffer.concat(chunks), (err) => {
        if (err) { send(res, 500); return; }
        try { refresh(entry); } catch { /* the write landed; the next one checks again */ }
        send(res, 204);
      });
    });
  }

  function rename(entry, req, res) {
    if (!entry.writable) { send(res, 405); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4096) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400); return; }
      const base = safeBase(body?.name);
      if (!base) { send(res, 400); return; }
      const next = path.join(path.dirname(entry.path), `${base}.xlsx`);
      try {
        if (fs.existsSync(next) && !samePath(fs.realpathSync(next), entry.path)) { send(res, 409); return; }
        if (!samePath(next, entry.path)) fs.renameSync(entry.path, next);
        entry.path = fs.realpathSync(next);
        refresh(entry);
      } catch {
        send(res, 500);
        return;
      }
      const payload = JSON.stringify({ name: base });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    });
  }

  /** True when this request is one of these files (answered here, not by the app's pages). */
  function handle(req, res) {
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { return false; }
    const file = /^\/__desktop\/file\/([a-f0-9]{32})$/.exec(url.pathname);
    const renamed = /^\/__desktop\/rename\/([a-f0-9]{32})$/.exec(url.pathname);
    if (!file && !renamed) {
      if (url.pathname.startsWith('/__desktop/')) { send(res, 404); return true; }
      return false;
    }
    const entry = files.get((file || renamed)[1]);
    if (!entry) { send(res, 404); return true; }
    if (file && (req.method === 'GET' || req.method === 'HEAD')) read(entry, req, res);
    else if (file && req.method === 'PUT') write(entry, req, res, url.searchParams.get('force') === '1');
    else if (renamed && req.method === 'POST') rename(entry, req, res);
    else send(res, 405);
    return true;
  }

  return {
    add,
    handle,
    get launch() { return launch; },
  };
}

module.exports = { createDesktopFiles, safeBase };
