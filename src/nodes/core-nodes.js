// Provider-agnostic building blocks: inputs, glue, generic HTTP, preview.

import { asText, media } from '../core/types.js';
import { getPath, renderTemplate, findMediaUrl } from '../util/extract.js';

export function registerCoreNodes(registry) {
  registry.register({
    type: 'text',
    title: 'Text',
    category: 'Input',
    accent: '#7dd3a0',
    hint: 'A prompt or any string. Drag its output into other nodes.',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'text' }],
    fields: [{ id: 'value', kind: 'textarea', label: '', placeholder: 'Type a prompt...', rows: 4 }],
    defaults: { value: '' },
    run({ data }) {
      return { text: data.value ?? '' };
    },
  });

  registry.register({
    type: 'number',
    title: 'Number',
    category: 'Input',
    accent: '#e4d072',
    inputs: [],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    fields: [{ id: 'value', kind: 'number', label: 'Value', step: 'any' }],
    defaults: { value: 5 },
    run({ data }) {
      return { value: Number(data.value) || 0 };
    },
  });

  registry.register({
    type: 'image-input',
    title: 'Image',
    category: 'Input',
    accent: '#f0a868',
    hint: 'Upload a file (kept in memory as a data URL) or paste an image URL.',
    inputs: [],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    fields: [
      { id: '_file', kind: 'file', label: 'Upload', accept: 'image/*' },
      { id: 'url', kind: 'text', label: 'or URL', placeholder: 'https://... or data:image/...' },
    ],
    defaults: { url: '' },
    run({ data }) {
      const url = data._file?.url || data.url;
      if (!url) throw new Error('Pick a file or paste an image URL.');
      return { image: media('image', url, { mime: data._file?.mime, name: data._file?.name }) };
    },
  });

  registry.register({
    type: 'model-input',
    title: '3D Model',
    category: 'Input',
    accent: '#f087b8',
    hint: 'A model you already have: upload a GLB, FBX, OBJ or STL, or point at one in your library.',
    inputs: [],
    outputs: [{ id: 'model', label: 'Model', type: 'model3d' }],
    fields: [
      { id: '_file', kind: 'file', label: 'Upload', accept: '.glb,.gltf,.fbx,.obj,.stl,model/gltf-binary' },
      { id: 'url', kind: 'text', label: 'or URL', placeholder: 'http://localhost:8787/library/file/models/...' },
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: { url: '' },
    run({ data, setData }) {
      const url = data._file?.url || data.url;
      if (!url) throw new Error('Upload a model file or paste a URL to one.');
      const name = data._file?.name ?? url.split('/').pop()?.split('?')[0] ?? 'model.glb';
      const value = media('model3d', url, {
        name,
        mime: data._file?.mime,
        previewable: /\.(glb|gltf)$/i.test(name),
        format: name.split('.').pop()?.toUpperCase(),
      });
      setData({ _result: value });
      return { model: value };
    },
  });

  registry.register({
    type: 'template',
    title: 'Template',
    category: 'Transform',
    accent: '#7dd3a0',
    hint: 'Compose text with {{a}}, {{b}}, {{c}} placeholders.',
    inputs: [
      { id: 'a', label: 'a', type: 'any' },
      { id: 'b', label: 'b', type: 'any' },
      { id: 'c', label: 'c', type: 'any' },
    ],
    outputs: [{ id: 'text', label: 'Text', type: 'text' }],
    fields: [{ id: 'template', kind: 'textarea', label: 'Template', rows: 4, placeholder: '{{a}} in the style of {{b}}' }],
    defaults: { template: '{{a}}' },
    run({ data, inputs }) {
      return {
        text: renderTemplate(data.template, {
          a: asText(inputs.a),
          b: asText(inputs.b),
          c: asText(inputs.c),
        }),
      };
    },
  });

  registry.register({
    type: 'extract',
    title: 'Extract',
    category: 'Transform',
    accent: '#69b7f0',
    hint: 'Read a path out of a JSON payload, or auto-find a media URL in it.',
    inputs: [{ id: 'json', label: 'JSON', type: 'json', required: true }],
    outputs: [
      { id: 'value', label: 'Value', type: 'any' },
      { id: 'text', label: 'Text', type: 'text' },
    ],
    fields: [
      {
        id: 'mode',
        kind: 'select',
        label: 'Mode',
        options: [
          { value: 'path', label: 'JSON path' },
          { value: 'video', label: 'Find video URL' },
          { value: 'image', label: 'Find image URL' },
        ],
      },
      { id: 'path', kind: 'text', label: 'Path', placeholder: 'choices[0].message.content', showWhen: { mode: 'path' } },
    ],
    defaults: { mode: 'path', path: '' },
    run({ data, inputs }) {
      const payload = inputs.json;
      if (data.mode === 'video' || data.mode === 'image') {
        const hit = findMediaUrl(payload, data.mode);
        if (!hit) throw new Error(`No ${data.mode} URL found in that payload.`);
        return { value: media(data.mode, hit.url), text: hit.url };
      }
      const value = getPath(payload, data.path);
      if (value === undefined) throw new Error(`Path "${data.path}" is not in that payload.`);
      return { value, text: asText(value) };
    },
  });

  registry.register({
    type: 'http',
    title: 'HTTP Request',
    category: 'Transform',
    accent: '#9aa3b2',
    hint: 'Plug in any REST API. {{input}} and {{image}} are substituted into the body.',
    inputs: [
      { id: 'input', label: 'Input', type: 'any' },
      { id: 'image', label: 'Image', type: 'image' },
    ],
    outputs: [{ id: 'json', label: 'JSON', type: 'json' }],
    fields: [
      {
        id: 'method',
        kind: 'select',
        label: 'Method',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'GET', label: 'GET' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
          { value: 'DELETE', label: 'DELETE' },
        ],
      },
      { id: 'url', kind: 'text', label: 'URL', placeholder: 'https://api.example.com/v1/thing' },
      { id: 'credential', kind: 'credential', label: 'Auth key' },
      { id: 'authHeader', kind: 'text', label: 'Auth header', placeholder: 'Authorization: Bearer {{key}}' },
      { id: 'headers', kind: 'textarea', label: 'Extra headers (JSON)', rows: 2, placeholder: '{"Accept": "application/json"}' },
      { id: 'body', kind: 'textarea', label: 'Body template (JSON)', rows: 5, placeholder: '{"prompt": "{{input}}"}' },
    ],
    defaults: {
      method: 'POST',
      url: '',
      credential: '',
      authHeader: 'Authorization: Bearer {{key}}',
      headers: '',
      body: '{\n  "prompt": "{{input}}"\n}',
    },
    cacheable: false,
    async run({ data, inputs, signal, keystore, log }) {
      if (!data.url) throw new Error('Set a URL.');
      const headers = { 'Content-Type': 'application/json' };
      if (data.headers?.trim()) {
        try {
          Object.assign(headers, JSON.parse(data.headers));
        } catch (err) {
          throw new Error(`Extra headers is not valid JSON: ${err.message}`);
        }
      }
      if (data.credential && data.authHeader?.includes(':')) {
        const key = keystore.require(data.credential, 'API key');
        const idx = data.authHeader.indexOf(':');
        const name = data.authHeader.slice(0, idx).trim();
        const value = renderTemplate(data.authHeader.slice(idx + 1).trim(), { key });
        headers[name] = value;
      }

      let body;
      if (data.method !== 'GET' && data.method !== 'DELETE') {
        const rendered = renderTemplate(data.body, {
          input: JSON.stringify(asText(inputs.input)).slice(1, -1), // escape for JSON string context
          image: inputs.image?.url ?? '',
          raw: asText(inputs.input),
        });
        try {
          body = JSON.stringify(JSON.parse(rendered));
        } catch (err) {
          throw new Error(`Body is not valid JSON after substitution: ${err.message}`);
        }
      }

      log(`${data.method} ${data.url}`);
      const response = await fetch(renderTemplate(data.url, { input: asText(inputs.input) }), {
        method: data.method,
        headers,
        body,
        signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { raw: text };
      }
      if (!response.ok) {
        throw new Error(`${response.status} ${payload?.error?.message ?? payload?.raw ?? response.statusText}`);
      }
      return { json: payload };
    },
  });

  registry.register({
    type: 'preview',
    title: 'Preview',
    category: 'Output',
    accent: '#c49bff',
    hint: 'Renders whatever it receives: text, image, video or JSON.',
    inputs: [{ id: 'value', label: 'In', type: 'any' }],
    outputs: [],
    fields: [{ id: '_preview', kind: 'preview', label: '' }],
    defaults: {},
    cacheable: false,
    run({ inputs, setData }) {
      setData({ _preview: inputs.value ?? null });
      return {};
    },
  });
}
