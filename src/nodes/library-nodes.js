// Saving work to the local folder, and notes about it.

import { asText } from '../core/types.js';
import { kindFor, saveToLibrary } from '../providers/library.js';
import { getGateway } from '../providers/gateway.js';

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function registerLibraryNodes(registry) {
  registry.register({
    type: 'save',
    title: 'Save to Library',
    category: 'Library',
    accent: '#e4d072',
    hint: 'Writes whatever it is given into your my-work folder, with notes attached.',
    inputs: [
      { id: 'asset', label: 'Asset', type: 'any', required: true },
      { id: 'notes', label: 'Notes', type: 'text' },
    ],
    outputs: [
      { id: 'path', label: 'Path', type: 'text' },
      { id: 'asset', label: 'Asset', type: 'any' },
    ],
    fields: [
      { id: 'title', kind: 'text', label: 'Title', placeholder: 'armor torso, first pass' },
      { id: 'tags', kind: 'text', label: 'Tags (comma separated)', placeholder: 'armor, hero prop' },
      { id: 'notes', kind: 'textarea', label: 'Notes', rows: 3, placeholder: 'what worked, what to change next time' },
      { id: '_saved', kind: 'info', label: '' },
    ],
    defaults: { title: '', tags: '', notes: '' },
    cacheable: false,
    async run({ data, inputs, signal, log, setData }) {
      const asset = inputs.asset;
      if (!asset) throw new Error('Connect something to save.');

      const kind = kindFor(asset);
      const url = typeof asset === 'string' ? asset : asset.url;
      const origin = getGateway();

      const extension = (asset?.name?.split('.').pop() ?? { models: 'glb', videos: 'mp4', images: 'png' }[kind]).toLowerCase();
      const base = (data.title || asset?.name?.replace(/\.[^.]+$/, '') || kind.slice(0, -1)).trim();
      const name = `${base.replace(/[^\w.\- ]+/g, '_')} ${stamp()}.${extension}`;

      const meta = {
        title: data.title || base,
        notes: [data.notes, asText(inputs.notes)].filter(Boolean).join('\n\n'),
        tags: data.tags.split(',').map((t) => t.trim()).filter(Boolean),
        kind,
        sourceUrl: asset?.sourceUrl ?? (typeof url === 'string' && !url.startsWith('blob:') ? url : undefined),
        format: asset?.format,
      };

      // A blob: URL only exists inside this page, so read it here and send the
      // bytes; anything remote the gateway can fetch itself.
      let payload;
      if (typeof url === 'string' && url.startsWith('blob:')) {
        const blob = await (await fetch(url, { signal })).blob();
        payload = {
          dataUrl: await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
        };
      } else if (typeof url === 'string' && url.startsWith('data:')) {
        payload = { dataUrl: url };
      } else if (typeof url === 'string') {
        payload = { fetchUrl: url };
      } else {
        payload = { text: JSON.stringify(asset, null, 2) };
        meta.kind = 'graphs';
      }

      log(`saving to my-work/${kind}`);
      const saved = await saveToLibrary({ kind: meta.kind ?? kind, name, meta, ...payload }, origin, signal);
      setData({ _saved: `saved as my-work/${saved.rel}` });
      log(`saved my-work/${saved.rel} (${Math.round(saved.bytes / 1024)} KB)`);
      return { path: saved.rel, asset };
    },
  });

  registry.register({
    type: 'note',
    title: 'Note',
    category: 'Library',
    accent: '#e4d072',
    hint: 'A sticky note. Anything typed here is saved with the graph.',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'text' }],
    fields: [{ id: 'value', kind: 'textarea', label: '', rows: 6, placeholder: 'Ideas, settings that worked, what to try next...' }],
    defaults: { value: '' },
    run({ data }) {
      return { text: data.value ?? '' };
    },
  });
}
