// Graph state: nodes, edges, viewport. Everything the UI renders comes from here.
// Credential *values* never enter this object - nodes only store a credential id.

import { emitter } from './events.js';
import { uid } from '../util/dom.js';
import { canConnect } from './types.js';

export const SCHEMA_VERSION = 1;

export function createStore(registry) {
  const bus = emitter();
  const state = {
    nodes: new Map(),
    edges: new Map(),
    view: { x: 0, y: 0, scale: 1 },
    selection: new Set(),
  };

  function addNode(type, position = { x: 80, y: 80 }, data = {}) {
    const def = registry.get(type);
    if (!def) throw new Error(`unknown node type: ${type}`);
    const node = {
      id: uid('n'),
      type,
      x: Math.round(position.x),
      y: Math.round(position.y),
      data: { ...structuredClone(def.defaults ?? {}), ...data },
      status: 'idle',
      message: '',
      outputs: {},
      cacheKey: null,
    };
    state.nodes.set(node.id, node);
    bus.emit('node:add', node);
    bus.emit('change');
    return node;
  }

  // Copies a node beside itself, keeping its settings but not its last result,
  // so variations can sit side by side.
  function duplicateNode(id, offset = { x: 40, y: 40 }) {
    const node = state.nodes.get(id);
    if (!node) return null;
    const data = {};
    for (const [key, value] of Object.entries(node.data)) {
      if (key === '_result' || key === '_preview') continue;
      data[key] = value;
    }
    return addNode(node.type, { x: node.x + offset.x, y: node.y + offset.y }, data);
  }

  function removeNode(id) {
    if (!state.nodes.has(id)) return;
    for (const edge of [...state.edges.values()]) {
      if (edge.from.node === id || edge.to.node === id) removeEdge(edge.id, { quiet: true });
    }
    state.nodes.delete(id);
    state.selection.delete(id);
    bus.emit('node:remove', id);
    bus.emit('change');
  }

  function moveNode(id, x, y) {
    const node = state.nodes.get(id);
    if (!node) return;
    node.x = Math.round(x);
    node.y = Math.round(y);
    bus.emit('node:move', node);
  }

  function updateNodeData(id, patch) {
    const node = state.nodes.get(id);
    if (!node) return;
    Object.assign(node.data, patch);
    node.cacheKey = null; // edits invalidate the cached result
    bus.emit('node:data', node);
    bus.emit('change');
  }

  function setNodeStatus(id, status, message = '') {
    const node = state.nodes.get(id);
    if (!node) return;
    node.status = status;
    node.message = message;
    bus.emit('node:status', node);
  }

  function setNodeOutputs(id, outputs, cacheKey = null) {
    const node = state.nodes.get(id);
    if (!node) return;
    node.outputs = outputs ?? {};
    node.cacheKey = cacheKey;
    bus.emit('node:outputs', node);
  }

  function portType(nodeId, portId, direction) {
    const node = state.nodes.get(nodeId);
    if (!node) return null;
    const def = registry.get(node.type);
    const ports = direction === 'out' ? def.outputs ?? [] : def.inputs ?? [];
    return ports.find((p) => p.id === portId)?.type ?? null;
  }

  // Returns { ok:true, edge } or { ok:false, reason }.
  function addEdge(from, to) {
    if (from.node === to.node) return { ok: false, reason: 'A node cannot feed itself.' };
    const fromType = portType(from.node, from.port, 'out');
    const toType = portType(to.node, to.port, 'in');
    if (!fromType || !toType) return { ok: false, reason: 'Unknown port.' };
    if (!canConnect(fromType, toType)) {
      return { ok: false, reason: `${fromType} output does not fit a ${toType} input.` };
    }
    if (createsCycle(from.node, to.node)) return { ok: false, reason: 'That would create a loop.' };

    // An input accepts a single edge; replace whatever was there.
    for (const edge of [...state.edges.values()]) {
      if (edge.to.node === to.node && edge.to.port === to.port) removeEdge(edge.id, { quiet: true });
    }
    const edge = { id: uid('e'), from: { ...from }, to: { ...to }, type: fromType };
    state.edges.set(edge.id, edge);
    invalidateFrom(to.node);
    bus.emit('edge:add', edge);
    bus.emit('change');
    return { ok: true, edge };
  }

  function removeEdge(id, { quiet = false } = {}) {
    const edge = state.edges.get(id);
    if (!edge) return;
    state.edges.delete(id);
    invalidateFrom(edge.to.node);
    bus.emit('edge:remove', edge);
    if (!quiet) bus.emit('change');
  }

  function createsCycle(fromNode, toNode) {
    // Walk downstream from `toNode`; if we reach `fromNode`, the edge closes a loop.
    const seen = new Set();
    const stack = [toNode];
    while (stack.length) {
      const current = stack.pop();
      if (current === fromNode) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of state.edges.values()) {
        if (edge.from.node === current) stack.push(edge.to.node);
      }
    }
    return false;
  }

  function incomingEdges(nodeId) {
    return [...state.edges.values()].filter((e) => e.to.node === nodeId);
  }

  function outgoingEdges(nodeId) {
    return [...state.edges.values()].filter((e) => e.from.node === nodeId);
  }

  // Drop cached results for a node and everything downstream of it.
  function invalidateFrom(nodeId) {
    const stack = [nodeId];
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = state.nodes.get(id);
      if (node) node.cacheKey = null;
      for (const edge of outgoingEdges(id)) stack.push(edge.to.node);
    }
  }

  function setView(view) {
    Object.assign(state.view, view);
    bus.emit('view', state.view);
  }

  function select(ids, { additive = false } = {}) {
    if (!additive) state.selection.clear();
    for (const id of [].concat(ids)) if (id) state.selection.add(id);
    bus.emit('selection', state.selection);
  }

  function serialize() {
    return {
      schema: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      view: { ...state.view },
      nodes: [...state.nodes.values()].map((n) => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        data: stripTransient(n.data),
      })),
      edges: [...state.edges.values()].map((e) => ({ id: e.id, from: e.from, to: e.to, type: e.type })),
    };
  }

  // Large pasted media and fetched results are per-session, not part of the doc.
  function stripTransient(data) {
    const copy = {};
    for (const [k, v] of Object.entries(data ?? {})) {
      if (k.startsWith('_')) continue;
      copy[k] = v;
    }
    return copy;
  }

  function load(doc) {
    if (!doc || typeof doc !== 'object') throw new Error('Not a graph file.');
    if (doc.schema && doc.schema > SCHEMA_VERSION) {
      throw new Error(`Graph was saved by a newer version (schema ${doc.schema}).`);
    }
    state.nodes.clear();
    state.edges.clear();
    state.selection.clear();
    const skipped = [];
    for (const raw of doc.nodes ?? []) {
      if (!registry.get(raw.type)) {
        skipped.push(raw.type);
        continue;
      }
      const def = registry.get(raw.type);
      state.nodes.set(raw.id, {
        id: raw.id,
        type: raw.type,
        x: raw.x ?? 0,
        y: raw.y ?? 0,
        data: { ...structuredClone(def.defaults ?? {}), ...(raw.data ?? {}) },
        status: 'idle',
        message: '',
        outputs: {},
        cacheKey: null,
      });
    }
    for (const raw of doc.edges ?? []) {
      if (!state.nodes.has(raw.from?.node) || !state.nodes.has(raw.to?.node)) continue;
      state.edges.set(raw.id ?? uid('e'), { id: raw.id ?? uid('e'), from: raw.from, to: raw.to, type: raw.type ?? 'any' });
    }
    if (doc.view) Object.assign(state.view, doc.view);
    bus.emit('reload');
    bus.emit('change');
    return { skipped };
  }

  function clearAll() {
    state.nodes.clear();
    state.edges.clear();
    state.selection.clear();
    bus.emit('reload');
    bus.emit('change');
  }

  return {
    state,
    registry,
    on: bus.on,
    emit: bus.emit,
    addNode,
    duplicateNode,
    removeNode,
    moveNode,
    updateNodeData,
    setNodeStatus,
    setNodeOutputs,
    addEdge,
    removeEdge,
    incomingEdges,
    outgoingEdges,
    invalidateFrom,
    portType,
    setView,
    select,
    serialize,
    load,
    clearAll,
  };
}
