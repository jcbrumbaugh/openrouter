// Renders one node as a card: header, ports, fields, inline preview.

import { clear, h } from '../util/dom.js';
import { PORT_COLORS } from '../core/types.js';
import { decodersNeeded } from '../util/glb.js';

// <model-viewer> is the one external dependency in the app, and it is fetched
// lazily: nothing loads from a CDN unless a 3D result actually appears. If the
// fetch fails (offline, blocked, strict CSP) the preview falls back to a
// download link rather than breaking the node.
const MODEL_VIEWER_SRC = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
let modelViewerPromise = null;

function loadModelViewer() {
  if (modelViewerPromise) return modelViewerPromise;
  modelViewerPromise = new Promise((resolve, reject) => {
    if (customElements.get('model-viewer')) {
      resolve();
      return;
    }
    const script = h('script', { type: 'module', src: MODEL_VIEWER_SRC });
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('viewer script could not be loaded')));
    document.head.append(script);
  });
  return modelViewerPromise;
}

const VIEWABLE = /\.(glb|gltf)$/i;

function renderModel3d(value) {
  const name = value.name ?? 'model.glb';
  const extension = (name.split('.').pop() ?? 'glb').toLowerCase();
  const links = h('div', { class: 'model-links' }, [
    h('a', { class: 'media-link', href: value.url, download: name }, `download .${extension}`),
    h('a', { class: 'media-link', href: value.sourceUrl ?? value.url, target: '_blank', rel: 'noreferrer' }, 'open'),
  ]);
  const stage = h('div', { class: 'model-stage' });
  const wrap = h('div', { class: 'preview' }, [stage, links]);
  const note = (text) => {
    clear(stage);
    stage.append(h('span', { class: 'model-note' }, text));
  };

  // The viewer only speaks glTF; anything else is download-only.
  if (!VIEWABLE.test(name)) {
    note(`.${extension} files cannot be previewed here - download it and open it in your 3D app.`);
    return wrap;
  }

  note('loading 3D viewer...');
  loadModelViewer()
    .then(() => {
      clear(stage);
      const viewer = h('model-viewer', {
        src: value.url,
        alt: '3D model',
        'camera-controls': true,
        'auto-rotate': true,
        'touch-action': 'pan-y',
        'shadow-intensity': '1',
        exposure: '1',
      });
      // A mesh served straight from a provider CDN usually fails here on CORS;
      // say so rather than showing an empty box.
      // model-viewer fires 'error' for several things; only a load failure means
      // the mesh itself did not display. Say which, because "it failed" is not
      // actionable and the usual cause is a decoder the viewer fetches at runtime.
      viewer.addEventListener('error', (event) => {
        const detail = event.detail ?? {};
        if (detail.type && detail.type !== 'loadfailure') return;
        const decoders = decodersNeeded(value.info ?? {});
        const reason = detail.sourceError?.message ?? detail.type ?? 'unknown error';
        note(
          decoders.length
            ? `This mesh uses ${decoders.join(' and ')}, and the decoder for it could not load here. The file is fine - download it, or re-export without compression. (${reason})`
            : `The viewer could not load this mesh: ${reason}. The file itself downloaded fine - use the download link.`,
        );
      });
      stage.append(viewer);
    })
    .catch(() => {
      note('No inline viewer available (the viewer library could not load). Use the download link - macOS previews .glb with Quick Look.');
    });

  return wrap;
}

const STATUS_LABEL = {
  idle: '',
  running: 'running',
  done: 'done',
  cached: 'cached',
  error: 'error',
};

function visible(field, data) {
  if (field.showWhen) {
    for (const [key, value] of Object.entries(field.showWhen)) {
      if (data[key] !== value) return false;
    }
  }
  if (field.hideWhen) {
    for (const [key, value] of Object.entries(field.hideWhen)) {
      if (data[key] === value) return false;
    }
  }
  return true;
}

export function renderPreview(value) {
  if (value === null || value === undefined || value === '') {
    return h('div', { class: 'preview empty' }, 'no result yet - press Run at the top');
  }
  if (typeof value === 'object' && value.type === 'video' && value.url) {
    return h('div', { class: 'preview' }, [
      h('video', { class: 'media', src: value.url, controls: true, playsinline: true, preload: 'metadata' }),
      h('a', { class: 'media-link', href: value.url, target: '_blank', rel: 'noreferrer' }, 'open video'),
    ]);
  }
  if (typeof value === 'object' && value.type === 'model3d' && value.url) {
    return renderModel3d(value);
  }
  if (typeof value === 'object' && value.type === 'image' && value.url) {
    return h('div', { class: 'preview' }, [
      h('img', { class: 'media', src: value.url, alt: 'result' }),
      h('a', { class: 'media-link', href: value.url, target: '_blank', rel: 'noreferrer' }, 'open image'),
    ]);
  }
  if (typeof value === 'string') {
    return h('div', { class: 'preview' }, [h('pre', { class: 'text-out' }, value)]);
  }
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return h('div', { class: 'preview' }, [h('pre', { class: 'text-out' }, text)]);
}

// Builds one field control. Returns { el, sync() } so programmatic data changes
// (a fetched model slug, a run result) can refresh it without a full re-render.
function buildField(field, ctx) {
  const { node, store, keystore, onFetchModels } = ctx;
  const value = node.data[field.id];
  let input = null;
  let body;
  let unsubscribe = null;
  let afterSync = null;

  const commit = (next) => store.updateNodeData(node.id, { [field.id]: next });

  switch (field.kind) {
    case 'textarea':
      input = h('textarea', {
        class: 'field-input',
        rows: field.rows ?? 3,
        placeholder: field.placeholder ?? '',
        oninput: (e) => commit(e.target.value),
      });
      input.value = value ?? '';
      body = input;
      break;

    case 'number':
      input = h('input', {
        class: 'field-input',
        type: 'number',
        step: field.step ?? 'any',
        min: field.min,
        max: field.max,
        oninput: (e) => commit(e.target.value === '' ? '' : Number(e.target.value)),
      });
      input.value = value ?? '';
      body = input;
      break;

    case 'range': {
      const readout = h('span', { class: 'field-readout' });
      const label = (raw) => {
        const n = Number(raw) || 0;
        if (n <= (field.min ?? 0)) return field.zeroLabel ?? String(field.min ?? 0);
        return n.toLocaleString();
      };
      input = h('input', {
        class: 'field-range',
        type: 'range',
        min: field.min ?? 0,
        max: field.max ?? 100,
        step: field.step ?? 1,
        oninput: (e) => {
          readout.textContent = label(e.target.value);
          commit(Number(e.target.value));
        },
      });
      input.value = value ?? field.min ?? 0;
      readout.textContent = label(input.value);
      afterSync = () => {
        readout.textContent = label(node.data[field.id]);
      };
      body = h('div', { class: 'field-slider' }, [input, readout]);
      break;
    }

    case 'checkbox':
      input = h('input', { type: 'checkbox', onchange: (e) => commit(e.target.checked) });
      input.checked = Boolean(value);
      body = h('label', { class: 'field-check' }, [input, field.label ?? '']);
      break;

    case 'select':
      input = h(
        'select',
        { class: 'field-input', onchange: (e) => commit(e.target.value) },
        (field.options ?? []).map((opt) => h('option', { value: opt.value }, opt.label ?? opt.value)),
      );
      input.value = value ?? field.options?.[0]?.value ?? '';
      body = input;
      break;

    case 'credential': {
      const rebuild = () => {
        // A node that names a provider only offers that provider's keys, so a
        // Runway key cannot be handed to Tripo by accident.
        const all = keystore.list();
        const options = field.provider ? all.filter((c) => c.provider === field.provider) : all;
        clear(input);
        const empty = field.provider
          ? `no ${field.provider} key yet`
          : 'no keys yet';
        input.append(h('option', { value: '' }, options.length ? 'select a key...' : empty));
        for (const cred of options) {
          input.append(h('option', { value: cred.id }, `${cred.label} (${keystore.mask(cred.id)})`));
        }
        input.value = node.data[field.id] ?? '';
      };
      input = h('select', { class: 'field-input', onchange: (e) => commit(e.target.value) });
      unsubscribe = keystore.subscribe(rebuild);
      rebuild();
      body = h('div', { class: 'field-row' }, [
        input,
        h('button', { class: 'mini', type: 'button', onclick: () => ctx.openKeys() }, 'Keys'),
      ]);
      break;
    }

    case 'model':
      input = h('input', {
        class: 'field-input',
        type: 'text',
        placeholder: field.placeholder ?? '',
        list: 'model-slugs',
        oninput: (e) => commit(e.target.value),
      });
      input.value = value ?? '';
      body = h('div', { class: 'field-row' }, [
        input,
        h(
          'button',
          {
            class: 'mini',
            type: 'button',
            title: 'Fetch model list from OpenRouter',
            onclick: () => onFetchModels(node),
          },
          '↻',
        ),
      ]);
      break;

    case 'file':
      input = h('input', {
        class: 'field-input',
        type: 'file',
        accept: field.accept ?? '*/*',
        onchange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          store.updateNodeData(node.id, { _file: { url, name: file.name, mime: file.type } });
        },
      });
      body = h('div', {}, [input, node.data._file?.name ? h('div', { class: 'field-note' }, node.data._file.name) : null]);
      break;

    case 'preview':
      body = renderPreview(value);
      break;

    case 'info':
      body = h('div', { class: 'field-note' }, field.text ?? '');
      break;

    default:
      input = h('input', {
        class: 'field-input',
        type: 'text',
        placeholder: field.placeholder ?? '',
        oninput: (e) => commit(e.target.value),
      });
      input.value = value ?? '';
      body = input;
  }

  const el = h('div', { class: `field${field.advanced ? ' advanced' : ''}`, dataset: { field: field.id } }, [
    field.label && field.kind !== 'checkbox' ? h('label', { class: 'field-label' }, field.label) : null,
    body,
  ]);

  return {
    el,
    field,
    destroy() {
      unsubscribe?.();
    },
    sync() {
      el.classList.toggle('hidden', !visible(field, node.data));
      const current = node.data[field.id];
      if (field.kind === 'preview') {
        clear(el);
        if (field.label) el.append(h('label', { class: 'field-label' }, field.label));
        el.append(renderPreview(current));
        return;
      }
      if (field.kind === 'file') {
        const note = el.querySelector('.field-note');
        const name = node.data._file?.name ?? '';
        if (note) note.textContent = name;
        else if (name) el.append(h('div', { class: 'field-note' }, name));
        return;
      }
      if (!input || document.activeElement === input) return;
      if (field.kind === 'checkbox') input.checked = Boolean(current);
      else input.value = current ?? '';
      afterSync?.();
    },
  };
}

export function createNodeCard(node, ctx) {
  const def = ctx.store.registry.get(node.type);
  const portEls = new Map();

  const statusEl = h('span', { class: 'node-status' });
  const card = h('div', {
    class: 'node',
    dataset: { nodeId: node.id, type: node.type },
    style: { transform: `translate(${node.x}px, ${node.y}px)`, '--accent': def.accent ?? '#9aa3b2' },
  });

  const header = h('div', { class: 'node-header', dataset: { drag: 'handle' } }, [
    h('span', { class: 'node-dot' }),
    h('span', { class: 'node-title', title: def.hint ?? '' }, def.title),
    statusEl,
    h(
      'button',
      {
        class: 'node-btn',
        type: 'button',
        title: 'Run this branch',
        onclick: (e) => {
          e.stopPropagation();
          ctx.onRunNode(node);
        },
      },
      '▶',
    ),
    h(
      'button',
      {
        class: 'node-btn danger',
        type: 'button',
        title: 'Delete node',
        onclick: (e) => {
          e.stopPropagation();
          ctx.store.removeNode(node.id);
        },
      },
      '✕',
    ),
  ]);
  card.append(header);

  const portRows = h('div', { class: 'ports' });
  const inputs = def.inputs ?? [];
  const outputs = def.outputs ?? [];
  const rows = Math.max(inputs.length, outputs.length);
  for (let i = 0; i < rows; i++) {
    const row = h('div', { class: 'port-row' });
    for (const [side, port] of [['in', inputs[i]], ['out', outputs[i]]]) {
      const cell = h('div', { class: `port-cell ${side}` });
      if (port) {
        const dot = h('span', {
          class: `port-dot ${side}`,
          dataset: { port: port.id, dir: side, ptype: port.type, nodeId: node.id },
          style: { background: PORT_COLORS[port.type] ?? PORT_COLORS.any },
          title: `${port.label ?? port.id} (${port.type})`,
        });
        const label = h('span', { class: 'port-label' }, port.label ?? port.id);
        cell.append(...(side === 'in' ? [dot, label] : [label, dot]));
        portEls.set(`${side}:${port.id}`, dot);
      }
      row.append(cell);
    }
    portRows.append(row);
  }
  if (rows) card.append(portRows);

  const fieldViews = (def.fields ?? []).map((field) => buildField(field, { ...ctx, node }));
  const hasAdvanced = fieldViews.some((v) => v.field.advanced);
  const body = h('div', { class: 'node-body' }, fieldViews.map((v) => v.el));
  card.append(body);

  if (hasAdvanced) {
    const toggle = h(
      'button',
      {
        class: 'advanced-toggle',
        type: 'button',
        onclick: () => {
          const open = body.classList.toggle('show-advanced');
          toggle.textContent = open ? 'Hide advanced' : 'Advanced';
        },
      },
      'Advanced',
    );
    card.append(toggle);
  }

  const messageEl = h('div', { class: 'node-message' });
  card.append(messageEl);

  function syncStatus() {
    card.dataset.status = node.status;
    statusEl.textContent = STATUS_LABEL[node.status] ?? '';
    messageEl.textContent = node.message ?? '';
    messageEl.classList.toggle('hidden', !node.message);
  }

  function syncFields() {
    for (const view of fieldViews) view.sync();
  }

  syncStatus();
  syncFields();

  return {
    el: card,
    node,
    portEls,
    syncStatus,
    syncFields,
    destroy() {
      for (const view of fieldViews) view.destroy();
    },
    setSelected(on) {
      card.classList.toggle('selected', on);
    },
    move() {
      card.style.transform = `translate(${node.x}px, ${node.y}px)`;
    },
  };
}
