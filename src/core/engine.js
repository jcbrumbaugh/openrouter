// Graph executor: topological order, per-node caching, cancellation.

import { asNumber, asText } from './types.js';

function stableStringify(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v, depth + 1)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k], depth + 1)}`).join(',')}}`;
}

// Presentation-only fields (a stored result, which variation is selected) must
// not count towards the cache key, or picking a favourite would look like a
// settings change and re-run a paid generation.
const ALWAYS_IGNORED = ['_result', '_preview'];

function cacheableData(data, def) {
  const ignored = new Set(def.cacheIgnore ?? ALWAYS_IGNORED);
  const out = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (ignored.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function createEngine(store, { keystore, log }) {
  let controller = null;

  const isRunning = () => controller !== null;

  function cancel() {
    controller?.abort(new DOMException('Run cancelled', 'AbortError'));
  }

  // Every node the target nodes depend on, in execution order.
  function plan(targetIds) {
    const needed = new Set();
    const stack = [...targetIds];
    while (stack.length) {
      const id = stack.pop();
      if (needed.has(id)) continue;
      needed.add(id);
      for (const edge of store.incomingEdges(id)) stack.push(edge.from.node);
    }
    const indegree = new Map();
    for (const id of needed) {
      indegree.set(id, store.incomingEdges(id).filter((e) => needed.has(e.from.node)).length);
    }
    const queue = [...needed].filter((id) => indegree.get(id) === 0);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const edge of store.outgoingEdges(id)) {
        if (!needed.has(edge.to.node)) continue;
        const left = indegree.get(edge.to.node) - 1;
        indegree.set(edge.to.node, left);
        if (left === 0) queue.push(edge.to.node);
      }
    }
    if (order.length !== needed.size) throw new Error('The graph contains a cycle.');
    return order;
  }

  function terminalNodes() {
    const ids = [...store.state.nodes.keys()];
    const withOutgoing = new Set([...store.state.edges.values()].map((e) => e.from.node));
    const terminals = ids.filter((id) => !withOutgoing.has(id));
    return terminals.length ? terminals : ids;
  }

  function collectInputs(node) {
    const def = store.registry.get(node.type);
    const inputs = {};
    for (const port of def.inputs ?? []) {
      const edge = store.incomingEdges(node.id).find((e) => e.to.port === port.id);
      if (!edge) {
        inputs[port.id] = undefined;
        continue;
      }
      const source = store.state.nodes.get(edge.from.node);
      let value = source?.outputs?.[edge.from.port];
      if (port.type === 'text') value = value === undefined ? undefined : asText(value);
      if (port.type === 'number') value = value === undefined ? undefined : asNumber(value);
      inputs[port.id] = value;
    }
    return inputs;
  }

  async function runNode(node, { force, signal }) {
    const def = store.registry.get(node.type);
    const inputs = collectInputs(node);

    for (const port of def.inputs ?? []) {
      if (port.required && (inputs[port.id] === undefined || inputs[port.id] === '')) {
        throw new Error(`Input "${port.label ?? port.id}" is required.`);
      }
    }

    const cacheKeyFor = () => hash(stableStringify({
      data: cacheableData(node.data, def),
      inputs,
      type: node.type,
    }));
    const key = cacheKeyFor();
    const cacheable = def.cacheable !== false;
    if (!force && cacheable && node.cacheKey === key) {
      store.setNodeStatus(node.id, 'cached', 'reused last result');
      return node.outputs;
    }

    store.setNodeStatus(node.id, 'running');
    const started = performance.now();
    const outputs = (await def.run({
      inputs,
      data: node.data,
      node,
      signal,
      keystore,
      log: (message, level) => log(message, level, node),
      setData: (patch) => store.updateNodeData(node.id, patch),
      setStatus: (message) => store.setNodeStatus(node.id, 'running', message),
    })) ?? {};

    const ms = Math.round(performance.now() - started);
    // setData inside run() clears cacheKey; recompute so caching still applies.
    const finalKey = cacheKeyFor();
    store.setNodeOutputs(node.id, outputs, cacheable ? finalKey : null);
    store.setNodeStatus(node.id, 'done', `${ms} ms`);
    return outputs;
  }

  async function run({ targets = null, force = false } = {}) {
    if (controller) {
      log('A run is already in flight.', 'warn');
      return { ok: false };
    }
    controller = new AbortController();
    const { signal } = controller;
    let order;
    try {
      order = plan(targets ?? terminalNodes());
    } catch (err) {
      controller = null;
      log(err.message, 'error');
      return { ok: false, error: err };
    }
    if (!order.length) {
      controller = null;
      log('Nothing to run - add a node first.', 'warn');
      return { ok: false };
    }

    store.emit('run:start', order);
    let failed = null;
    for (const id of order) {
      const node = store.state.nodes.get(id);
      if (!node) continue;
      if (signal.aborted) {
        store.setNodeStatus(id, 'idle', 'cancelled');
        continue;
      }
      try {
        await runNode(node, { force, signal });
      } catch (err) {
        const aborted = err?.name === 'AbortError';
        store.setNodeStatus(id, aborted ? 'idle' : 'error', aborted ? 'cancelled' : err.message);
        if (!aborted) log(`${store.registry.get(node.type).title}: ${err.message}`, 'error', node);
        failed = err;
        break; // downstream nodes have nothing to consume
      }
    }
    controller = null;
    store.emit('run:end', { failed });
    return { ok: !failed, error: failed };
  }

  return { run, cancel, isRunning, plan, terminalNodes, collectInputs };
}
