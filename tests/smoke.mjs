// Headless smoke test: serves the app plus a mock OpenRouter API on the same
// origin, then drives the real UI in Chromium.
//
//   npm test

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

let pollCount = 0;
const apiCalls = [];

function mockApi(req, res, url, body, origin) {
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  apiCalls.push(`${req.method} ${url.pathname}`);

  if (url.pathname === '/api/v1/models') {
    return json(200, {
      data: [
        { id: 'bytedance/seedance-2.5', name: 'Seedance 2.5' },
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      ],
    });
  }
  if (url.pathname === '/api/v1/chat/completions') {
    if (!req.headers.authorization) return json(401, { error: { message: 'no key' } });
    return json(200, {
      choices: [{ message: { role: 'assistant', content: `echo: ${body?.messages?.at(-1)?.content ?? ''}` } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
  }
  if (url.pathname === '/api/v1/videos' && req.method === 'POST') {
    if (!req.headers.authorization) return json(401, { error: { message: 'no key' } });
    if (!body?.prompt) return json(400, { error: { message: 'prompt required' } });
    pollCount = 0;
    return json(200, { id: 'job_1', status: 'queued', model: body.model });
  }
  if (url.pathname === '/api/v1/videos/job_1' && req.method === 'GET') {
    pollCount += 1;
    if (pollCount < 2) return json(200, { id: 'job_1', status: 'processing' });
    return json(200, {
      id: 'job_1',
      status: 'succeeded',
      data: { video_url: `${origin}/tests/fixtures/clip.mp4` },
    });
  }
  return json(404, { error: { message: `no mock for ${url.pathname}` } });
}

async function serveFile(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      } catch {
        body = null;
      }
      return mockApi(req, res, url, body, origin);
    }
    return serveFile(res, url.pathname);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- assertions ----------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
    console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
// The sandbox ships a Chromium build that may not match this playwright
// version's expected revision, so prefer an explicit binary when one is there.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

try {
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.nodeSpace !== undefined, null, { timeout: 10000 });

  // 1. boot + starter graph
  check('app boots without page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  const nodeCount = await page.locator('.node').count();
  check('starter graph renders 3 nodes', nodeCount === 3, `saw ${nodeCount}`);
  const wireCount = await page.locator('path.wire').count();
  check('starter graph renders 2 wires', wireCount === 2, `saw ${wireCount}`);

  // 2. palette adds a node
  await page.getByRole('button', { name: 'OpenRouter Chat' }).click();
  check('palette click adds a node', (await page.locator('.node').count()) === 4);

  // 3. wiring by drag: text output -> chat prompt input
  const textOut = page.locator('.node[data-type="text"] .port-dot.out').first();
  const chatIn = page.locator('.node[data-type="or-chat"] .port-dot.in').first();
  const a = await textOut.boundingBox();
  const b = await chatIn.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const edges = await page.evaluate(() => window.nodeSpace.store.state.edges.size);
  check('dragging between ports creates an edge', edges === 3, `edges=${edges}`);

  // 4. type checking and cycle guard
  const guards = await page.evaluate(() => {
    const { store } = window.nodeSpace;
    const ids = [...store.state.nodes.values()];
    const text = ids.find((n) => n.type === 'text');
    const chat = ids.find((n) => n.type === 'or-chat');
    const image = store.addNode('image-input', { x: 0, y: 900 });
    const badType = store.addEdge({ node: image.id, port: 'image' }, { node: chat.id, port: 'prompt' });
    const cycle = store.addEdge({ node: chat.id, port: 'text' }, { node: text.id, port: 'a' });
    store.removeNode(image.id);
    return { badType, cycle };
  });
  check('image output is rejected by a text input', guards.badType.ok === false, JSON.stringify(guards.badType));
  check('loops are rejected', guards.cycle.ok === false, JSON.stringify(guards.cycle));

  // 5. keys + running the video branch against the mock API
  await page.evaluate((baseUrl) => {
    const { keystore, store } = window.nodeSpace;
    const id = keystore.save({ label: 'test key', value: 'sk-or-v1-testkey', provider: 'openrouter' });
    for (const node of store.state.nodes.values()) {
      if (node.type.startsWith('or-')) {
        store.updateNodeData(node.id, { credential: id, baseUrl: `${baseUrl}/api/v1`, pollSeconds: 1 });
      }
    }
  }, base);

  await page.locator('#run').click();
  await page.waitForSelector('.node[data-type="preview"] video', { timeout: 20000 });
  const src = await page.locator('.node[data-type="preview"] video').getAttribute('src');
  check('video branch resolves to a clip URL', src?.endsWith('/tests/fixtures/clip.mp4'), src ?? 'no src');
  check('submit + poll both happened',
    apiCalls.includes('POST /api/v1/videos') && apiCalls.filter((c) => c === 'GET /api/v1/videos/job_1').length >= 2,
    apiCalls.join(', '));
  const videoStatus = await page.locator('.node[data-type="or-video"]').getAttribute('data-status');
  check('video node reports done', videoStatus === 'done', `status=${videoStatus}`);

  // 6. chat node ran too
  const chatText = await page.evaluate(() => {
    const node = [...window.nodeSpace.store.state.nodes.values()].find((n) => n.type === 'or-chat');
    return node?.outputs?.text ?? null;
  });
  check('chat node returned text', typeof chatText === 'string' && chatText.startsWith('echo:'), String(chatText));

  // 7. exported graph carries no secrets
  const exported = await page.evaluate(() => JSON.stringify(window.nodeSpace.store.serialize()));
  check('export contains no key material', !exported.includes('sk-or-v1-testkey'));
  check('export keeps the credential reference', exported.includes('"credential"'));

  // 8. missing key is a clear error, not a crash
  const keyError = await page.evaluate(async () => {
    const { store, engine } = window.nodeSpace;
    const chat = store.addNode('or-chat', { x: 0, y: 1200 }, { credential: '' });
    const prompt = store.addNode('text', { x: -300, y: 1200 }, { value: 'hi' });
    store.addEdge({ node: prompt.id, port: 'text' }, { node: chat.id, port: 'prompt' });
    await engine.run({ targets: [chat.id], force: true });
    const message = store.state.nodes.get(chat.id).message;
    store.removeNode(chat.id);
    store.removeNode(prompt.id);
    return message;
  });
  check('missing key produces a readable message', /No OpenRouter key/i.test(keyError), keyError);

  // 9. autosave survives a reload
  const before = await page.evaluate(() => window.nodeSpace.store.state.nodes.size);
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => window.nodeSpace !== undefined);
  const after = await page.evaluate(() => window.nodeSpace.store.state.nodes.size);
  check('graph is restored after reload', after === before, `${before} -> ${after}`);

  // 10. quick add popover (on a spot with no node under it)
  const spot = await page.evaluate(() => {
    const rect = document.getElementById('canvas').getBoundingClientRect();
    for (const [x, y] of [[600, 700], [80, 780], [1000, 780], [300, 400]]) {
      const el = document.elementFromPoint(rect.left + x, rect.top + y);
      if (el && el.id === 'canvas') return { x, y };
    }
    return null;
  });
  check('found empty canvas space for quick add', spot !== null);
  await page.locator('#canvas').dblclick({ position: spot ?? { x: 600, y: 700 } });
  check('double-click opens quick add', await page.locator('.quick-add:not(.hidden)').isVisible());
  await page.locator('.quick-add .quick-search').fill('seed');
  const quickMatches = await page.locator('.quick-add .palette-item').count();
  check('quick add filters by name', quickMatches === 1, `matches=${quickMatches}`);
  await page.locator('.quick-add .palette-item').first().click();
  check('quick add inserts the node', (await page.evaluate(() => window.nodeSpace.store.state.nodes.size)) === after + 1);

  check('no console errors during the whole run', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
