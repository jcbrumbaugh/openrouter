#!/usr/bin/env node
// Static file server for local development.
//
//   node scripts/serve.mjs [--port 8080] [--open]
//
// Exists because opening index.html straight from the filesystem does not work:
// browsers refuse to load ES modules over file://.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const startPort = Number(flag('--port') ?? process.env.PORT ?? 8080);
const shouldOpen = args.includes('--open');

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`not found: ${rel}`);
  }
});

// Hunt for a free port so a leftover server does not block a fresh start.
function listen(port, attemptsLeft = 12) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${server.address().port}`;
    console.log(`\n  Node Space is running at ${url}`);
    console.log('  Press Control-C to stop.\n');
    if (shouldOpen) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    }
  });
}

listen(startPort);
