// Pan/zoom canvas: node cards in a transformed world layer, wires in an SVG
// layer underneath them.

import { clear, h, svg } from '../util/dom.js';
import { PORT_COLORS, canConnect } from '../core/types.js';
import { createNodeCard } from './nodecard.js';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

function offsetWithin(el, ancestor) {
  let x = 0;
  let y = 0;
  let cursor = el;
  while (cursor && cursor !== ancestor) {
    x += cursor.offsetLeft;
    y += cursor.offsetTop;
    cursor = cursor.offsetParent;
  }
  return { x, y };
}

function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function createCanvas(root, ctx) {
  const { store } = ctx;
  const wires = svg('svg', { class: 'wires' });
  const nodesLayer = h('div', { class: 'nodes' });
  const world = h('div', { class: 'world' }, [wires, nodesLayer]);
  const hint = h('div', { class: 'canvas-hint' }, 'Double-click the canvas to add a node');
  root.append(world, hint);

  const cards = new Map();
  const wirePaths = new Map();
  let selectedEdge = null;
  let dragWire = null;
  let redrawQueued = false;
  let topZ = 1;

  const view = store.state.view;

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    ctx.onViewChange?.(view);
  }

  function toGraph(clientX, clientY) {
    const rect = root.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  function portPosition(nodeId, portId, dir) {
    const card = cards.get(nodeId);
    if (!card) return null;
    const dot = card.portEls.get(`${dir}:${portId}`);
    if (!dot) return null;
    const off = offsetWithin(dot, card.el);
    return {
      x: card.node.x + off.x + dot.offsetWidth / 2,
      y: card.node.y + off.y + dot.offsetHeight / 2,
    };
  }

  function scheduleRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      redrawWires();
    });
  }

  function redrawWires() {
    for (const edge of store.state.edges.values()) {
      let entry = wirePaths.get(edge.id);
      if (!entry) {
        const hit = svg('path', { class: 'wire-hit' });
        const line = svg('path', { class: 'wire' });
        line.setAttribute('stroke', PORT_COLORS[edge.type] ?? PORT_COLORS.any);
        hit.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          selectEdge(edge.id);
        });
        hit.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          store.removeEdge(edge.id);
        });
        wires.append(hit, line);
        entry = { hit, line };
        wirePaths.set(edge.id, entry);
      }
      const from = portPosition(edge.from.node, edge.from.port, 'out');
      const to = portPosition(edge.to.node, edge.to.port, 'in');
      if (!from || !to) continue;
      const d = wirePath(from, to);
      entry.line.setAttribute('d', d);
      entry.hit.setAttribute('d', d);
      entry.line.classList.toggle('selected', selectedEdge === edge.id);
    }
    for (const [id, entry] of wirePaths) {
      if (!store.state.edges.has(id)) {
        entry.hit.remove();
        entry.line.remove();
        wirePaths.delete(id);
      }
    }
    hint.classList.toggle('hidden', store.state.nodes.size > 0);
  }

  function selectEdge(id) {
    selectedEdge = id;
    store.select([]);
    scheduleRedraw();
  }

  function addCard(node) {
    const card = createNodeCard(node, ctx);
    cards.set(node.id, card);
    card.el.style.zIndex = String(++topZ);
    nodesLayer.append(card.el);
    scheduleRedraw();
    return card;
  }

  function rebuild() {
    for (const card of cards.values()) card.destroy();
    clear(nodesLayer);
    clear(wires);
    cards.clear();
    wirePaths.clear();
    for (const node of store.state.nodes.values()) addCard(node);
    applyView();
    scheduleRedraw();
  }

  // ---- interaction ------------------------------------------------------

  function beginNodeDrag(event, card) {
    const start = toGraph(event.clientX, event.clientY);
    const origin = { x: card.node.x, y: card.node.y };
    root.setPointerCapture?.(event.pointerId);
    const move = (e) => {
      const now = toGraph(e.clientX, e.clientY);
      store.moveNode(card.node.id, origin.x + (now.x - start.x), origin.y + (now.y - start.y));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.emit('change');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginPan(event) {
    const origin = { x: view.x, y: view.y, cx: event.clientX, cy: event.clientY };
    root.classList.add('panning');
    const move = (e) => {
      view.x = origin.x + (e.clientX - origin.cx);
      view.y = origin.y + (e.clientY - origin.cy);
      applyView();
    };
    const up = () => {
      root.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function beginWire(event, dot) {
    const dir = dot.dataset.dir;
    const nodeId = dot.dataset.nodeId;
    const portId = dot.dataset.port;
    const type = dot.dataset.ptype;

    // Dragging from a connected input detaches that edge instead of starting a new one.
    if (dir === 'in') {
      const existing = store.incomingEdges(nodeId).find((e) => e.to.port === portId);
      if (existing) store.removeEdge(existing.id);
    }

    const anchor = portPosition(nodeId, portId, dir);
    const line = svg('path', { class: 'wire dragging' });
    line.setAttribute('stroke', PORT_COLORS[type] ?? PORT_COLORS.any);
    wires.append(line);
    dragWire = { line, dir, nodeId, portId, type };
    root.classList.add('wiring');
    highlightTargets(type, dir);

    const move = (e) => {
      const pos = toGraph(e.clientX, e.clientY);
      line.setAttribute('d', dir === 'out' ? wirePath(anchor, pos) : wirePath(pos, anchor));
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      line.remove();
      root.classList.remove('wiring');
      clearHighlights();
      dragWire = null;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port-dot');
      if (!target) return;
      if (target.dataset.dir === dir) {
        ctx.log('Connect an output to an input.', 'warn');
        return;
      }
      const from = dir === 'out'
        ? { node: nodeId, port: portId }
        : { node: target.dataset.nodeId, port: target.dataset.port };
      const to = dir === 'out'
        ? { node: target.dataset.nodeId, port: target.dataset.port }
        : { node: nodeId, port: portId };
      const result = store.addEdge(from, to);
      if (!result.ok) ctx.log(result.reason, 'warn');
    };
    move(event);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function highlightTargets(type, dir) {
    const wantDir = dir === 'out' ? 'in' : 'out';
    for (const dot of nodesLayer.querySelectorAll('.port-dot')) {
      if (dot.dataset.dir !== wantDir) continue;
      const ok = dir === 'out' ? canConnect(type, dot.dataset.ptype) : canConnect(dot.dataset.ptype, type);
      dot.classList.toggle('compatible', ok);
      dot.classList.toggle('incompatible', !ok);
    }
  }

  function clearHighlights() {
    for (const dot of nodesLayer.querySelectorAll('.port-dot')) {
      dot.classList.remove('compatible', 'incompatible');
    }
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      beginPan(event);
      return;
    }
    if (event.button !== 0) return;
    const dot = event.target.closest('.port-dot');
    if (dot) {
      event.preventDefault();
      event.stopPropagation();
      beginWire(event, dot);
      return;
    }
    const cardEl = event.target.closest('.node');
    if (cardEl) {
      const card = cards.get(cardEl.dataset.nodeId);
      selectedEdge = null;
      store.select(card.node.id, { additive: event.shiftKey });
      // Raise with z-index, never by re-appending: moving a card in the DOM
      // tears down whatever is mid-interaction inside it, which closes native
      // <select> popups the instant they open.
      cardEl.style.zIndex = String(++topZ);
      const interactive = event.target.closest('input, textarea, select, button, a, video, label, .preview');
      if (!interactive) {
        event.preventDefault();
        beginNodeDrag(event, card);
      }
      return;
    }
    selectedEdge = null;
    store.select([]);
    beginPan(event);
    scheduleRedraw();
  });

  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    // Keep the point under the cursor fixed while zooming.
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    applyView();
  }, { passive: false });

  root.addEventListener('dblclick', (event) => {
    if (event.target.closest('.node') || event.target.closest('.wire-hit')) return;
    ctx.onQuickAdd(toGraph(event.clientX, event.clientY), { clientX: event.clientX, clientY: event.clientY });
  });

  window.addEventListener('keydown', (event) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && !typing) {
      event.preventDefault();
      const copies = [...store.state.selection].map((id) => store.duplicateNode(id)).filter(Boolean);
      if (copies.length) {
        store.select(copies.map((c) => c.id));
        ctx.log(`duplicated ${copies.length} node${copies.length > 1 ? 's' : ''}`);
      }
      return;
    }

    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (selectedEdge) {
      store.removeEdge(selectedEdge);
      selectedEdge = null;
      return;
    }
    for (const id of [...store.state.selection]) store.removeNode(id);
  });

  // ---- store wiring -----------------------------------------------------

  store.on('node:add', (node) => addCard(node));
  store.on('node:remove', (id) => {
    const card = cards.get(id);
    card?.destroy();
    card?.el.remove();
    cards.delete(id);
    scheduleRedraw();
  });
  store.on('node:move', (node) => {
    cards.get(node.id)?.move();
    scheduleRedraw();
  });
  store.on('node:data', (node) => {
    cards.get(node.id)?.syncFields();
    scheduleRedraw();
  });
  store.on('node:outputs', () => scheduleRedraw());
  store.on('node:status', (node) => cards.get(node.id)?.syncStatus());
  store.on('edge:add', () => scheduleRedraw());
  store.on('edge:remove', () => scheduleRedraw());
  store.on('reload', () => rebuild());
  store.on('selection', (selection) => {
    for (const [id, card] of cards) card.setSelected(selection.has(id));
  });

  applyView();
  scheduleRedraw();

  return {
    rebuild,
    applyView,
    toGraph,
    resetView() {
      view.x = 0;
      view.y = 0;
      view.scale = 1;
      applyView();
    },
    fitView() {
      const nodes = [...store.state.nodes.values()];
      if (!nodes.length) return;
      const rect = root.getBoundingClientRect();
      const pad = 60;
      const minX = Math.min(...nodes.map((n) => n.x));
      const minY = Math.min(...nodes.map((n) => n.y));
      const maxX = Math.max(...nodes.map((n) => n.x + (cards.get(n.id)?.el.offsetWidth ?? 260)));
      const maxY = Math.max(...nodes.map((n) => n.y + (cards.get(n.id)?.el.offsetHeight ?? 200)));
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(
        (rect.width - pad * 2) / Math.max(1, maxX - minX),
        (rect.height - pad * 2) / Math.max(1, maxY - minY),
      )));
      view.scale = scale;
      view.x = pad - minX * scale;
      view.y = pad - minY * scale;
      applyView();
    },
    centerOfView() {
      const rect = root.getBoundingClientRect();
      return toGraph(rect.left + rect.width / 2, rect.top + rect.height / 3);
    },
  };
}
