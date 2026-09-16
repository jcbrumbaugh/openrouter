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
let hy3dPolls = 0;
const apiCalls = [];

// A minimal stand-in for Hunyuan3D's api_server.py: POST /send returns a uid,
// GET /status/{uid} reports processing -> texturing -> completed with the mesh
// as base64, exactly as the real server does.
const FAKE_GLB = Buffer.from('glTF fake binary payload for tests').toString('base64');

// Tripo and Runway stand-ins, shaped like the real APIs (contracts read from
// tripo3d 0.4.2 and @runwayml/sdk 4.20.0).
let tripoPolls = 0;
let runwayPolls = 0;
let tripoLastBody = null;
let runwayLastBody = null;

function mockApi(req, res, url, body, origin) {
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  apiCalls.push(`${req.method} ${url.pathname}`);

  if (url.pathname === '/fetch') {
    const remote = url.searchParams.get('url');
    if (!remote) return json(400, { error: { message: 'no url' } });
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
    res.end(Buffer.from('glTF relayed bytes'));
    return;
  }
  if (url.pathname === '/health') {
    return json(200, { status: 'ok', providers: ['openrouter', 'tripo', 'runway'], keysFromEnv: {} });
  }
  if (url.pathname === '/tripo/v2/openapi/upload' && req.method === 'POST') {
    return json(200, { code: 0, data: { image_token: 'tok_abc' } });
  }
  if (url.pathname === '/tripo/v2/openapi/task' && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer tripo-key') return json(401, { code: 1002, message: 'invalid token' });
    tripoLastBody = body;
    // Follow-up tasks (convert/texture/stylize) reference an existing mesh.
    if (body?.original_model_task_id) return json(200, { code: 0, data: { task_id: 'tripo_task_2' } });
    tripoPolls = 0;
    return json(200, { code: 0, data: { task_id: 'tripo_task_1' } });
  }
  if (url.pathname === '/tripo/v2/openapi/task/tripo_task_2') {
    return json(200, {
      code: 0,
      data: { status: 'success', output: { pbr_model: `${origin}/tests/fixtures/model.glb` } },
    });
  }
  if (url.pathname === '/tripo/v2/openapi/task/tripo_task_1') {
    tripoPolls += 1;
    if (tripoPolls < 2) return json(200, { code: 0, data: { status: 'running', progress: 40 } });
    return json(200, {
      code: 0,
      data: {
        status: 'success',
        progress: 100,
        output: {
          pbr_model: `${origin}/tests/fixtures/model.glb`,
          rendered_image: `${origin}/tests/fixtures/render.png`,
        },
      },
    });
  }
  if (url.pathname === '/runway/v1/image_to_video' && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer runway-key') return json(401, { error: 'unauthorized' });
    if (req.headers['x-runway-version'] !== '2024-11-06') return json(400, { error: 'missing X-Runway-Version' });
    if (!body?.promptImage) return json(400, { error: 'promptImage required' });
    runwayLastBody = body;
    runwayPolls = 0;
    return json(200, { id: 'runway_task_1' });
  }
  if (url.pathname === '/runway/v1/tasks/runway_task_1') {
    runwayPolls += 1;
    if (runwayPolls < 2) return json(200, { id: 'runway_task_1', status: 'RUNNING' });
    return json(200, { id: 'runway_task_1', status: 'SUCCEEDED', output: [`${origin}/tests/fixtures/clip.mp4`] });
  }
  if (url.pathname === '/hy3d/send' && req.method === 'POST') {
    if (!body?.image?.startsWith('data:image/')) {
      return json(400, { message: 'image must be a base64 data URL' });
    }
    hy3dPolls = 0;
    return json(200, { uid: 'mesh_1' });
  }
  if (url.pathname === '/hy3d/status/mesh_1' && req.method === 'GET') {
    hy3dPolls += 1;
    if (hy3dPolls === 1) return json(200, { status: 'processing' });
    if (hy3dPolls === 2) return json(200, { status: 'texturing' });
    return json(200, { status: 'completed', model_base64: FAKE_GLB });
  }
  if (url.pathname === '/hy3d/status/missing') {
    return json(200, { status: 'error', message: 'out of VRAM' });
  }
  if (url.pathname === '/api/v1/key') {
    if (req.headers.authorization === 'Bearer sk-or-v1-testkey') {
      return json(200, { data: { label: 'test key', usage: 0.42, limit: 10 } });
    }
    return json(401, { error: { message: 'User not found.' } });
  }
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
    if (['/health', '/fetch'].includes(url.pathname)
      || ['/api/', '/hy3d/', '/tripo/', '/runway/'].some((p) => url.pathname.startsWith(p))) {
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

// Network failures some checks provoke on purpose: a revoked key, a server that
// is not running, the gateway poll with no gateway, and the viewer CDN while
// offline. Chromium logs each as a resource notice. Real script errors arrive
// through the 'pageerror' handler and are never filtered.
const EXPECTED_NOISE =
  /status of 401|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|cdn\.jsdelivr|model-viewer/;
const realErrors = (list) => list.filter((text) => !EXPECTED_NOISE.test(text));

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
  check('app boots without page errors', realErrors(consoleErrors).length === 0, consoleErrors.join(' | '));
  const nodeCount = await page.locator('.node').count();
  check('starter graph renders its 6 nodes', nodeCount === 6, `saw ${nodeCount}`);
  const wireCount = await page.locator('path.wire').count();
  check('starter graph renders its 5 wires', wireCount === 5, `saw ${wireCount}`);
  check('starter graph wires Tripo into Runway', await page.evaluate(() => {
    const { store } = window.nodeSpace;
    const tripo = [...store.state.nodes.values()].find((n) => n.type === 'tripo-3d');
    const runway = [...store.state.nodes.values()].find((n) => n.type === 'runway-video');
    return store.outgoingEdges(tripo.id).some((e) => e.to.node === runway.id && e.from.port === 'render');
  }));

  // 2. palette adds a node
  await page.getByRole('button', { name: 'OpenRouter Chat' }).click();
  check('palette click adds a node', (await page.locator('.node').count()) === 7);

  // 3. wiring by drag: text output -> chat prompt input.
  // Park the new node in clear space first; a card sitting under another one
  // would make the drop land on the wrong element.
  await page.evaluate(() => {
    const { store, canvas } = window.nodeSpace;
    const chat = [...store.state.nodes.values()].find((n) => n.type === 'or-chat');
    const text = [...store.state.nodes.values()].find((n) => n.type === 'text');
    store.moveNode(chat.id, text.x + 420, text.y);
    canvas.fitView();
  });
  await page.waitForTimeout(200);
  const edgesBefore = await page.evaluate(() => window.nodeSpace.store.state.edges.size);
  const textOut = page.locator('.node[data-type="text"] .port-dot.out').first();
  const chatIn = page.locator('.node[data-type="or-chat"] .port-dot.in').first();
  const a = await textOut.boundingBox();
  const b = await chatIn.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const edges = await page.evaluate(() => window.nodeSpace.store.state.edges.size);
  check('dragging between ports creates an edge', edges === edgesBefore + 1, `${edgesBefore} -> ${edges}`);

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

  // 5. keys + running an OpenRouter video branch against the mock API.
  // Built explicitly rather than reusing the starter graph, so Run has exactly
  // this chain to execute.
  await page.evaluate((baseUrl) => {
    const { keystore, store } = window.nodeSpace;
    store.clearAll();
    const id = keystore.save({ label: 'test key', value: 'sk-or-v1-testkey', provider: 'openrouter' });
    const prompt = store.addNode('text', { x: 40, y: 80 }, { value: 'a neon alley' });
    const video = store.addNode('or-video', { x: 380, y: 40 });
    const chat = store.addNode('or-chat', { x: 380, y: 520 });
    const preview = store.addNode('preview', { x: 720, y: 80 });
    const chatOut = store.addNode('preview', { x: 720, y: 520 });
    store.addEdge({ node: prompt.id, port: 'text' }, { node: video.id, port: 'prompt' });
    store.addEdge({ node: prompt.id, port: 'text' }, { node: chat.id, port: 'prompt' });
    store.addEdge({ node: video.id, port: 'video' }, { node: preview.id, port: 'value' });
    store.addEdge({ node: chat.id, port: 'text' }, { node: chatOut.id, port: 'value' });
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

  // 11. a native dropdown inside a node must survive the click that opens it.
  // Regression: "bring clicked node to front" used to re-append the card, which
  // re-parents the <select> and kills the popup the moment it opens.
  await page.evaluate(() => window.nodeSpace.canvas.fitView());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__domChurn = 0;
    new MutationObserver((records) => {
      for (const r of records) window.__domChurn += r.removedNodes.length + r.addedNodes.length;
    }).observe(document.querySelector('.nodes'), { childList: true });
  });
  const credSelect = page.locator('.node[data-type="or-video"] select').first();
  const credBox = await credSelect.boundingBox();
  await page.mouse.click(credBox.x + credBox.width / 2, credBox.y + credBox.height / 2);
  await page.waitForTimeout(150);
  const churn = await page.evaluate(() => window.__domChurn);
  check('clicking a node dropdown does not re-parent the card', churn === 0, `dom changes=${churn}`);
  check('the dropdown keeps focus', (await page.evaluate(() => document.activeElement?.tagName)) === 'SELECT');
  check('clicking a node still raises it', await page.evaluate(() => {
    const z = Number(document.querySelector('.node[data-type="or-video"]').style.zIndex);
    const others = [...document.querySelectorAll('.node')].map((el) => Number(el.style.zIndex) || 0);
    return z === Math.max(...others);
  }));
  const picked = await page.evaluate(() => {
    const node = [...window.nodeSpace.store.state.nodes.values()].find((n) => n.type === 'or-video');
    const select = document.querySelector('.node[data-type="or-video"] select');
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return window.nodeSpace.store.state.nodes.get(node.id).data.credential;
  });
  check('picking a key stores it on the node', Boolean(picked), String(picked));

  // 12. the Keys panel can tell a working key from a rejected one
  await page.locator('#keys').click();
  await page.locator('.modal:not(.hidden)').waitFor();
  await page.locator('.key-row', { hasText: 'test key' }).getByRole('button', { name: 'Test' }).click();
  await page.waitForSelector('.key-verdict.ok', { timeout: 10000 });
  const goodVerdict = await page.locator('.key-verdict.ok').first().textContent();
  check('Test reports a working key', /Working/.test(goodVerdict), goodVerdict);
  check('Test shows the key usage', /used \$0\.42|limit \$10/.test(goodVerdict), goodVerdict);

  await page.evaluate(() => window.nodeSpace.keystore.save({ label: 'revoked key', value: 'sk-or-v1-dead', provider: 'openrouter' }));
  await page.locator('.key-row', { hasText: 'revoked key' }).getByRole('button', { name: 'Test' }).click();
  await page.waitForSelector('.key-verdict.err', { timeout: 10000 });
  const badVerdict = await page.locator('.key-verdict.err').first().textContent();
  check('Test flags a rejected key as revoked or mistyped', /Rejected \(401\)/.test(badVerdict), badVerdict);
  await page.locator('.modal-head button').click();
  await page.evaluate(() => window.nodeSpace.keystore.list().forEach((c) => {
    if (c.label === 'revoked key') window.nodeSpace.keystore.remove(c.id);
  }));

  // 13. Hunyuan3D: image in, mesh out, against a mock of its real API
  const meshResult = await page.evaluate(async (baseUrl) => {
    const { store, engine } = window.nodeSpace;
    const image = store.addNode('image-input', { x: 0, y: 1600 }, {
      _file: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', name: 'in.png', mime: 'image/png' },
    });
    const hy3d = store.addNode('hy3d', { x: 320, y: 1600 }, {
      serverUrl: `${baseUrl}/hy3d`,
      pollSeconds: 1,
      texture: true,
    });
    const preview = store.addNode('preview', { x: 640, y: 1600 });
    store.addEdge({ node: image.id, port: 'image' }, { node: hy3d.id, port: 'image' });
    store.addEdge({ node: hy3d.id, port: 'model' }, { node: preview.id, port: 'value' });
    await engine.run({ targets: [preview.id], force: true });
    const node = store.state.nodes.get(hy3d.id);
    return {
      status: node.status,
      message: node.message,
      model: node.outputs.model ?? null,
      previewId: preview.id,
    };
  }, base);
  check('Hunyuan3D node completes a submit + poll run', meshResult.status === 'done', `${meshResult.status}: ${meshResult.message}`);
  check('Hunyuan3D emits a model3d value', meshResult.model?.type === 'model3d', JSON.stringify(meshResult.model));
  check('the mesh is handed over as a blob URL', meshResult.model?.url?.startsWith('blob:'), meshResult.model?.url ?? 'none');
  check('the mesh keeps a .glb filename', /\.glb$/.test(meshResult.model?.name ?? ''), meshResult.model?.name ?? 'none');
  check('submit + both poll stages happened',
    apiCalls.includes('POST /hy3d/send') && apiCalls.filter((c) => c === 'GET /hy3d/status/mesh_1').length >= 3,
    apiCalls.filter((c) => c.includes('hy3d')).join(', '));

  // The viewer script is a CDN module and the test runs offline, so the preview
  // must still offer the mesh rather than showing nothing.
  await page.evaluate(() => window.nodeSpace.canvas.fitView());
  await page.waitForSelector('.model-links a[download]', { timeout: 10000 });
  const download = await page.locator('.model-links a[download]').first().getAttribute('download');
  check('3D preview offers a download even with no viewer', /\.glb$/.test(download ?? ''), download ?? 'none');

  // port typing: a mesh is not an image
  const meshTyping = await page.evaluate(() => {
    const { store } = window.nodeSpace;
    const hy3d = [...store.state.nodes.values()].find((n) => n.type === 'hy3d');
    const chat = store.addNode('or-chat', { x: 0, y: 2000 });
    const bad = store.addEdge({ node: hy3d.id, port: 'model' }, { node: chat.id, port: 'image' });
    store.removeNode(chat.id);
    return bad;
  });
  check('a mesh cannot be wired into an image input', meshTyping.ok === false, JSON.stringify(meshTyping));

  // a server that is not running must say so in plain language
  const offline = await page.evaluate(async () => {
    const { store, engine } = window.nodeSpace;
    const image = store.addNode('image-input', { x: 0, y: 2200 }, {
      _file: { url: 'data:image/png;base64,iVBORw0KGgo=', name: 'x.png', mime: 'image/png' },
    });
    const hy3d = store.addNode('hy3d', { x: 320, y: 2200 }, { serverUrl: 'http://127.0.0.1:9999', pollSeconds: 1 });
    store.addEdge({ node: image.id, port: 'image' }, { node: hy3d.id, port: 'image' });
    await engine.run({ targets: [hy3d.id], force: true });
    const message = store.state.nodes.get(hy3d.id).message;
    store.removeNode(hy3d.id);
    store.removeNode(image.id);
    return message;
  });
  check('an unreachable Hunyuan3D server explains itself', /Could not reach the Hunyuan3D server/.test(offline), offline);

  // 14. the full pipeline: image -> Tripo mesh + render -> Runway video
  const pipeline = await page.evaluate(async (baseUrl) => {
    const { store, engine, keystore } = window.nodeSpace;
    const tripoKey = keystore.save({ label: 'tripo test', value: 'tripo-key', provider: 'tripo' });
    const runwayKey = keystore.save({ label: 'runway test', value: 'runway-key', provider: 'runway' });

    const image = store.addNode('image-input', { x: 0, y: 2600 }, {
      _file: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', name: 'armor.png', mime: 'image/png' },
    });
    const tripo = store.addNode('tripo-3d', { x: 320, y: 2600 }, {
      credential: tripoKey,
      baseUrl: `${baseUrl}/tripo/v2/openapi`,
      pollSeconds: 1,
    });
    const prompt = store.addNode('text', { x: 320, y: 2950 }, { value: 'slow orbit, studio light' });
    const video = store.addNode('runway-video', { x: 660, y: 2700 }, {
      credential: runwayKey,
      baseUrl: `${baseUrl}/runway`,
      pollSeconds: 1,
      model: 'seedance2_5',
    });
    const out = store.addNode('preview', { x: 1000, y: 2700 });

    store.addEdge({ node: image.id, port: 'image' }, { node: tripo.id, port: 'front' });
    store.addEdge({ node: tripo.id, port: 'render' }, { node: video.id, port: 'image' });
    store.addEdge({ node: prompt.id, port: 'text' }, { node: video.id, port: 'prompt' });
    store.addEdge({ node: video.id, port: 'video' }, { node: out.id, port: 'value' });

    await engine.run({ targets: [out.id], force: true });
    const tripoNode = store.state.nodes.get(tripo.id);
    const videoNode = store.state.nodes.get(video.id);
    return {
      tripo: { status: tripoNode.status, message: tripoNode.message, outputs: tripoNode.outputs },
      video: { status: videoNode.status, message: videoNode.message, outputs: videoNode.outputs },
    };
  }, base);

  check('Tripo task completes', pipeline.tripo.status === 'done', `${pipeline.tripo.status}: ${pipeline.tripo.message}`);
  check('Tripo returns a mesh', pipeline.tripo.outputs?.model?.type === 'model3d', JSON.stringify(pipeline.tripo.outputs?.model));
  check('the mesh is pulled local so it can be previewed',
    pipeline.tripo.outputs?.model?.url?.startsWith('blob:'),
    pipeline.tripo.outputs?.model?.url ?? 'none');
  check('the mesh remembers where it came from',
    pipeline.tripo.outputs?.model?.sourceUrl?.endsWith('/tests/fixtures/model.glb'),
    pipeline.tripo.outputs?.model?.sourceUrl ?? 'none');
  check('Tripo exposes its task id for chaining', pipeline.tripo.outputs?.taskId === 'tripo_task_1', String(pipeline.tripo.outputs?.taskId));
  check('Tripo returns a rendered preview image', pipeline.tripo.outputs?.render?.type === 'image', JSON.stringify(pipeline.tripo.outputs?.render));
  check('a local image is uploaded and sent as a file_token',
    tripoLastBody?.file?.file_token === 'tok_abc' && tripoLastBody?.type === 'image_to_model',
    JSON.stringify(tripoLastBody?.file));
  check('the chosen Tripo model version is sent', tripoLastBody?.model_version === 'v3.1-20260211', String(tripoLastBody?.model_version));

  check('Runway task completes', pipeline.video.status === 'done', `${pipeline.video.status}: ${pipeline.video.message}`);
  check('Runway drives the video from the Tripo render',
    typeof runwayLastBody?.promptImage === 'string' && runwayLastBody.promptImage.endsWith('/render.png'),
    String(runwayLastBody?.promptImage));
  check('Seedance 2.5 is the model sent to Runway', runwayLastBody?.model === 'seedance2_5', String(runwayLastBody?.model));
  check('the prompt reaches Runway', runwayLastBody?.promptText === 'slow orbit, studio light', String(runwayLastBody?.promptText));
  check('Runway output URL becomes a playable video',
    pipeline.video.outputs?.video?.url?.endsWith('/tests/fixtures/clip.mp4'),
    pipeline.video.outputs?.video?.url ?? 'none');

  // 15. several views feed one reconstruction
  const multiview = await page.evaluate(async (baseUrl) => {
    const { store, engine, keystore } = window.nodeSpace;
    const tripoKey = keystore.list().find((c) => c.provider === 'tripo').id;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const view = (label, y) => store.addNode('image-input', { x: -300, y }, {
      _file: { url: png, name: `${label}.png`, mime: 'image/png' },
    });
    const front = view('front', 3400);
    const left = view('left', 3560);
    const right = view('right', 3720);
    const tripo = store.addNode('tripo-3d', { x: 40, y: 3400 }, {
      credential: tripoKey,
      baseUrl: `${baseUrl}/tripo/v2/openapi`,
      pollSeconds: 1,
    });
    store.addEdge({ node: front.id, port: 'image' }, { node: tripo.id, port: 'front' });
    store.addEdge({ node: left.id, port: 'image' }, { node: tripo.id, port: 'left' });
    store.addEdge({ node: right.id, port: 'image' }, { node: tripo.id, port: 'right' });
    await engine.run({ targets: [tripo.id], force: true });
    return { status: store.state.nodes.get(tripo.id).status, message: store.state.nodes.get(tripo.id).message };
  }, base);
  check('a multiview run completes', multiview.status === 'done', `${multiview.status}: ${multiview.message}`);
  check('multiple views switch the task to multiview_to_model', tripoLastBody?.type === 'multiview_to_model', String(tripoLastBody?.type));
  check('views are sent in front/left/back/right order with gaps kept',
    Array.isArray(tripoLastBody?.files)
      && tripoLastBody.files.length === 4
      && tripoLastBody.files[0]?.file_token === 'tok_abc'
      && tripoLastBody.files[1]?.file_token === 'tok_abc'
      && tripoLastBody.files[2] === null
      && tripoLastBody.files[3]?.file_token === 'tok_abc',
    JSON.stringify(tripoLastBody?.files));

  const turboRejected = await page.evaluate(async () => {
    const { store, engine } = window.nodeSpace;
    const tripo = [...store.state.nodes.values()].reverse().find((n) => n.type === 'tripo-3d');
    store.updateNodeData(tripo.id, { modelVersion: 'Turbo-v1.0-20250506' });
    await engine.run({ targets: [tripo.id], force: true });
    const message = store.state.nodes.get(tripo.id).message;
    store.updateNodeData(tripo.id, { modelVersion: 'v3.1-20260211' });
    return message;
  });
  check('Turbo plus multiview is refused with a reason', /Turbo does not accept multiple views/.test(turboRejected), turboRejected);

  // 16. a finished mesh can be run through a follow-up task
  const refined = await page.evaluate(async (baseUrl) => {
    const { store, engine, keystore } = window.nodeSpace;
    const tripoKey = keystore.list().find((c) => c.provider === 'tripo').id;
    const source = [...store.state.nodes.values()].find((n) => n.type === 'tripo-3d' && n.outputs?.taskId);
    const post = store.addNode('tripo-post', { x: 400, y: 3400 }, {
      credential: tripoKey,
      baseUrl: `${baseUrl}/tripo/v2/openapi`,
      pollSeconds: 1,
      mode: 'convert_model',
      format: 'FBX',
    });
    store.addEdge({ node: source.id, port: 'taskId' }, { node: post.id, port: 'taskId' });
    await engine.run({ targets: [post.id], force: true });
    const node = store.state.nodes.get(post.id);
    return { status: node.status, message: node.message, model: node.outputs?.model ?? null };
  }, base);
  check('a follow-up Tripo task completes', refined.status === 'done', `${refined.status}: ${refined.message}`);
  check('the follow-up references the original task', tripoLastBody?.original_model_task_id === 'tripo_task_1', String(tripoLastBody?.original_model_task_id));
  check('the requested export format is sent', tripoLastBody?.format === 'FBX', String(tripoLastBody?.format));
  check('the converted file keeps its real extension', /\.fbx$/.test(refined.model?.name ?? ''), refined.model?.name ?? 'none');

  // 17. duplicating a node, for trying variations side by side
  const duplicated = await page.evaluate(() => {
    const { store } = window.nodeSpace;
    const source = [...store.state.nodes.values()].find((n) => n.type === 'tripo-3d');
    store.select(source.id);
    const before = store.state.nodes.size;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    const after = store.state.nodes.size;
    const copy = [...store.state.nodes.values()].at(-1);
    return {
      added: after - before,
      sameType: copy.type === source.type,
      copiedSettings: copy.data.credential === source.data.credential && copy.data.modelVersion === source.data.modelVersion,
      offset: copy.x !== source.x || copy.y !== source.y,
      freshResult: copy.data._result === undefined,
    };
  });
  check('Cmd+D duplicates the selected node', duplicated.added === 1 && duplicated.sameType, JSON.stringify(duplicated));
  check('the copy keeps its settings', duplicated.copiedSettings === true, JSON.stringify(duplicated));
  check('the copy sits beside the original with no stale result', duplicated.offset && duplicated.freshResult, JSON.stringify(duplicated));

  // 18. credential dropdowns are scoped per provider
  const scoping = await page.evaluate(() => {
    const labels = (type) => {
      const card = document.querySelector(`.node[data-type="${type}"] select`);
      return [...card.options].map((o) => o.textContent);
    };
    return { tripo: labels('tripo-3d'), runway: labels('runway-video') };
  });
  check('a Tripo node only offers Tripo keys',
    scoping.tripo.some((t) => t.includes('tripo test')) && !scoping.tripo.some((t) => t.includes('runway test')),
    scoping.tripo.join(' | '));
  check('a Runway node only offers Runway keys',
    scoping.runway.some((t) => t.includes('runway test')) && !scoping.runway.some((t) => t.includes('tripo test')),
    scoping.runway.join(' | '));

  // 16. a mesh-only blob URL cannot be sent to Runway, and says why
  const blobRejected = await page.evaluate(async () => {
    const { store, engine, keystore } = window.nodeSpace;
    const fake = store.addNode('text', { x: 0, y: 3200 }, { value: 'x' });
    store.removeNode(fake.id);
    const video = [...store.state.nodes.values()].find((n) => n.type === 'runway-video');
    const original = video.outputs;
    const image = store.addNode('image-input', { x: 0, y: 3200 }, { url: 'blob:http://localhost/abc' });
    const edge = store.addEdge({ node: image.id, port: 'image' }, { node: video.id, port: 'image' });
    await engine.run({ targets: [video.id], force: true });
    const message = store.state.nodes.get(video.id).message;
    store.removeEdge(edge.edge.id);
    store.removeNode(image.id);
    video.outputs = original;
    return message;
  });
  check('a page-local blob image is refused with an explanation', /public URL or a data URL/.test(blobRejected), blobRejected);

  // 17. the toolbar says whether the gateway is running
  const gatewayDown = await page.locator('#gateway').getAttribute('data-state');
  check('gateway shows as off when it is not running', gatewayDown === 'down', String(gatewayDown));
  const downTitle = await page.locator('#gateway').getAttribute('title');
  check('the off state explains what to do', /start\.command/.test(downTitle ?? ''), downTitle ?? '');

  const gatewayUp = await page.evaluate(async (origin) => {
    const { checkGateway } = await import('/src/providers/gateway.js');
    return checkGateway(origin);
  }, base);
  check('a running gateway reports ok', gatewayUp.up === true, JSON.stringify(gatewayUp));
  check('the gateway names its providers',
    ['openrouter', 'tripo', 'runway'].every((p) => gatewayUp.providers.includes(p)),
    JSON.stringify(gatewayUp.providers));

  // The revoked-key check above deliberately provokes a 401, and Chromium logs
  // every failed request to the console; that one is expected.
  const unexpected = realErrors(consoleErrors);
  check('no unexpected console errors during the whole run', unexpected.length === 0, unexpected.join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
