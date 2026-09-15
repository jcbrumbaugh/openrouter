// Renders the app in headless Chromium and refreshes docs/screenshot.png.
//
//   node tests/screenshot.mjs

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const rel = req.url === '/' ? 'index.html' : req.url.replace(/^\/+/, '').split('?')[0];
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end('no');
  try {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.nodeSpace !== undefined);
await page.evaluate(() => {
  const { store, keystore, canvas } = window.nodeSpace;
  store.clearAll();
  keystore.save({ label: 'OpenRouter', value: 'sk-or-v1-demo-placeholder', provider: 'openrouter' });
  const id = keystore.defaultFor('openrouter');
  const prompt = store.addNode('text', { x: 40, y: 80 }, {
    value: 'A slow dolly through a neon-lit alley after rain, steam rising, cinematic.',
  });
  const video = store.addNode('or-video', { x: 380, y: 40 }, { credential: id });
  const preview = store.addNode('preview', { x: 740, y: 120 });
  store.addEdge({ node: prompt.id, port: 'text' }, { node: video.id, port: 'prompt' });
  store.addEdge({ node: video.id, port: 'video' }, { node: preview.id, port: 'value' });
  canvas.fitView();
});
await page.waitForTimeout(400);
const outDir = process.env.SHOT_DIR ?? path.join(ROOT, 'docs');
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, 'screenshot.png');
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
server.close();
