// Bootstrap: build the registry, store, engine and UI, then wire the toolbar.

import { createRegistry } from './nodes/registry.js';
import { registerCoreNodes } from './nodes/core-nodes.js';
import { registerOpenRouterNodes } from './nodes/openrouter-nodes.js';
import { registerHunyuan3dNodes } from './nodes/hunyuan3d-nodes.js';
import { registerTripoNodes } from './nodes/tripo-nodes.js';
import { registerRunwayNodes } from './nodes/runway-nodes.js';
import { createStore } from './core/store.js';
import { createEngine } from './core/engine.js';
import { createKeystore } from './providers/keystore.js';
import { listModels } from './providers/openrouter.js';
import { createCanvas } from './ui/canvas.js';
import { createPalette, createQuickAdd } from './ui/palette.js';
import { createKeysModal } from './ui/keys-modal.js';
import { createLog } from './ui/log.js';
import { clear, h } from './util/dom.js';

const AUTOSAVE_KEY = 'nodespace.graph.v1';

const registry = createRegistry();
registerCoreNodes(registry);
registerOpenRouterNodes(registry);
registerHunyuan3dNodes(registry);
registerTripoNodes(registry);
registerRunwayNodes(registry);

const keystore = createKeystore();
const store = createStore(registry);

const logPanel = createLog(document.getElementById('log'));
const log = (message, level, node) => logPanel.log(message, level, node);

const engine = createEngine(store, { keystore, log });
const keysModal = createKeysModal(document.body, {
  keystore,
  // Reuse whatever base URL the graph already points at (e.g. the local proxy).
  getBaseUrl: () => {
    for (const node of store.state.nodes.values()) {
      if (node.type.startsWith('or-') && node.data.baseUrl) return node.data.baseUrl;
    }
    return '';
  },
});

const canvasRoot = document.getElementById('canvas');

async function fetchModels(node) {
  const credential = node.data.credential || keystore.defaultFor('openrouter');
  if (!credential) {
    log('Add an OpenRouter key first (toolbar > Keys).', 'warn');
    keysModal.open();
    return;
  }
  try {
    log('fetching model list...');
    const payload = await listModels({ baseUrl: node.data.baseUrl, apiKey: keystore.get(credential) });
    const slugs = (payload?.data ?? []).map((m) => m.id).sort();
    const datalist = document.getElementById('model-slugs');
    clear(datalist);
    for (const slug of slugs) datalist.append(h('option', { value: slug }));
    log(`${slugs.length} models available`);
    const seedance = slugs.filter((s) => s.toLowerCase().includes('seedance'));
    if (seedance.length) log(`seedance slugs: ${seedance.join(', ')}`);
    else log('No "seedance" slug in the list - check the model name on openrouter.ai/models.', 'warn');
  } catch (err) {
    log(`model list failed: ${err.message}`, 'error');
  }
}

const canvas = createCanvas(canvasRoot, {
  store,
  keystore,
  log,
  openKeys: () => keysModal.open(),
  onFetchModels: fetchModels,
  onRunNode: (node) => engine.run({ targets: [node.id], force: true }),
  onQuickAdd: (graphPoint, screenPoint) => quickAdd.open(graphPoint, screenPoint),
  onViewChange: (view) => {
    document.getElementById('zoom-label').textContent = `${Math.round(view.scale * 100)}%`;
  },
});

const quickAdd = createQuickAdd(document.body, {
  registry,
  onPick: (def, position) => store.addNode(def.type, position),
});

createPalette(document.getElementById('palette'), {
  registry,
  onPick: (def) => {
    const center = canvas.centerOfView();
    store.addNode(def.type, { x: center.x - 130, y: center.y });
  },
});

// ---- persistence ---------------------------------------------------------

let saveTimer = null;
store.on('change', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(store.serialize()));
    } catch (err) {
      console.warn('autosave failed', err);
    }
  }, 400);
});

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function starterGraph() {
  // The pipeline this app was built around: a still image becomes a mesh, and
  // Tripo's rendered preview of that mesh drives a video for animation reference.
  const image = store.addNode('image-input', { x: 40, y: 200 });
  const tripo = store.addNode('tripo-3d', { x: 360, y: 60 }, {
    credential: keystore.defaultFor('tripo'),
  });
  const meshPreview = store.addNode('preview', { x: 700, y: 60 });
  const prompt = store.addNode('text', { x: 360, y: 640 }, {
    value: 'slow orbit around the subject, even studio lighting, no camera shake',
  });
  const video = store.addNode('runway-video', { x: 700, y: 420 }, {
    credential: keystore.defaultFor('runway'),
  });
  const videoPreview = store.addNode('preview', { x: 1040, y: 420 });

  store.addEdge({ node: image.id, port: 'image' }, { node: tripo.id, port: 'image' });
  store.addEdge({ node: tripo.id, port: 'model' }, { node: meshPreview.id, port: 'value' });
  store.addEdge({ node: tripo.id, port: 'render' }, { node: video.id, port: 'image' });
  store.addEdge({ node: prompt.id, port: 'text' }, { node: video.id, port: 'prompt' });
  store.addEdge({ node: video.id, port: 'video' }, { node: videoPreview.id, port: 'value' });
}

function boot() {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    try {
      const { skipped } = store.load(JSON.parse(saved));
      if (skipped.length) log(`Skipped unknown node types: ${skipped.join(', ')}`, 'warn');
      log('Restored your last graph.');
      return;
    } catch (err) {
      log(`Could not restore the saved graph: ${err.message}`, 'warn');
    }
  }
  starterGraph();
  log('Loaded the image -> 3D -> video starter graph. Add your keys under "Keys", and start the gateway with "npm run proxy".');
}

// ---- toolbar -------------------------------------------------------------

const runBtn = document.getElementById('run');
const stopBtn = document.getElementById('stop');

function setRunning(running) {
  runBtn.disabled = running;
  stopBtn.disabled = !running;
  runBtn.textContent = running ? 'Running...' : 'Run ▶';
}

store.on('run:start', (order) => {
  setRunning(true);
  log(`run: ${order.length} node(s)`);
});
store.on('run:end', ({ failed }) => {
  setRunning(false);
  if (!failed) log('run finished');
});

runBtn.addEventListener('click', () => engine.run({}));
document.getElementById('run-force').addEventListener('click', () => engine.run({ force: true }));
stopBtn.addEventListener('click', () => {
  engine.cancel();
  log('cancelling...', 'warn');
});
document.getElementById('keys').addEventListener('click', () => keysModal.open());
document.getElementById('fit').addEventListener('click', () => canvas.fitView());
document.getElementById('reset-view').addEventListener('click', () => canvas.resetView());
document.getElementById('export').addEventListener('click', () => {
  download(`node-space-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(store.serialize(), null, 2));
  log('graph exported (keys are not included)');
});
document.getElementById('import').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const { skipped } = store.load(JSON.parse(await file.text()));
    log(`imported ${file.name}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`);
  } catch (err) {
    log(`import failed: ${err.message}`, 'error');
  }
  event.target.value = '';
});
document.getElementById('clear').addEventListener('click', () => {
  if (!store.state.nodes.size || confirm('Clear the whole canvas?')) {
    store.clearAll();
    log('canvas cleared');
  }
});
document.getElementById('starter').addEventListener('click', () => {
  starterGraph();
  canvas.fitView();
  log('added the image -> 3D -> video chain');
});

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (typing) return;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    engine.run({});
  }
});

setRunning(false);
boot();

// Exposed for the smoke tests in tests/ and for poking around in devtools.
window.nodeSpace = { store, engine, registry, keystore, canvas, log };
