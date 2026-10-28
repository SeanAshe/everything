/**
 * Serves the built spreadsheet on the loopback interface.
 *
 * Puter.js signs a page in by its origin. A file:// page has none, so the SDK
 * shows "Unsupported Origin" and will not sign in. A loopback HTTP address
 * has an origin Puter accepts (the same as http://localhost), and keeping the
 * port fixed means the saved sign-in still belongs to this app on the next launch.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOSTS = ['127.0.0.1', '::1'];
const PORT = 47653;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** A file inside `root` for this request path, or null when the path leaves the folder. */
function resolveDistFile(root, urlPath) {
  const dist = path.resolve(root);
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const rel = pathname.replace(/^[/\\]+/, '');
  if (!rel) return null;
  const file = path.resolve(dist, rel);
  const fromRoot = path.relative(dist, file);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null;
  return file;
}

function createHandler(root) {
  const dist = path.resolve(root);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const file = resolveDistFile(dist, req.url || '/');
    if (!file) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      // readFile, not a stream: Electron's asar archive supports readFile for files packed inside it.
      fs.readFile(file, (readErr, data) => {
        if (readErr) {
          if (!res.headersSent) res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.end(data);
      });
    });
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      server.off('listening', ok);
      reject(err);
    };
    const ok = () => {
      server.off('error', fail);
      resolve(server);
    };
    server.once('error', fail);
    server.once('listening', ok);
    server.listen(port, host);
  });
}

/**
 * Listens on 127.0.0.1 and, when the machine has IPv6, ::1, so `localhost`
 * works whichever address the browser tries first. Returns the servers that
 * started. The IPv4 bind is required; a missing IPv6 stack is ignored.
 */
async function listenLoopback(root, port = PORT, route) {
  const serve = createHandler(root);
  const handler = (req, res) => {
    if (route?.(req, res)) return;
    serve(req, res);
  };
  const servers = [];
  servers.push(await listen(http.createServer(handler), HOSTS[0], port));
  try {
    servers.push(await listen(http.createServer(handler), HOSTS[1], port));
  } catch (err) {
    // No IPv6, or this port is already covered on ::1. The IPv4 listener is the one the window uses.
    if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EAFNOSUPPORT' && err.code !== 'EINVAL' && err.code !== 'EADDRINUSE') {
      for (const server of servers) server.close();
      throw err;
    }
  }
  return servers;
}

module.exports = { PORT, resolveDistFile, listenLoopback };
