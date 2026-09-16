// Tripo: image -> 3D mesh, hosted (no GPU of your own required).

import { media } from '../core/types.js';
import { dataUrlToBlob, sleep } from '../util/media.js';
import {
  DEFAULT_TRIPO_BASE,
  TRIPO_MODEL_VERSIONS,
  TERMINAL_BAD,
  TERMINAL_OK,
  createTask,
  getTask,
  uploadImage,
} from '../providers/tripo.js';

// Tripo takes a public URL as-is; a local upload has to go through /upload first.
async function resolveFile({ imageUrl, baseUrl, apiKey, signal, log }) {
  if (/^https?:\/\//i.test(imageUrl)) {
    const type = /\.png(\?|$)/i.test(imageUrl) ? 'png' : 'jpg';
    return { type, url: imageUrl };
  }
  if (imageUrl.startsWith('data:')) {
    const { blob, extension } = dataUrlToBlob(imageUrl);
    log('uploading image to Tripo');
    const token = await uploadImage({ baseUrl, apiKey, blob, filename: `input.${extension}`, signal });
    return { type: extension === 'png' ? 'png' : 'jpg', file_token: token };
  }
  throw new Error('That image is neither a URL nor uploadable data.');
}

export function registerTripoNodes(registry) {
  registry.register({
    type: 'tripo-3d',
    title: 'Tripo 3D',
    category: '3D',
    accent: '#5ed3c4',
    hint: 'Hosted image-to-3D. Also returns a rendered preview image you can feed to a video model.',
    inputs: [{ id: 'image', label: 'Image', type: 'image', required: true }],
    outputs: [
      { id: 'model', label: 'Model', type: 'model3d' },
      { id: 'render', label: 'Render', type: 'image' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'Tripo key', provider: 'tripo' },
      { id: 'modelVersion', kind: 'select', label: 'Model', options: TRIPO_MODEL_VERSIONS },
      { id: 'texture', kind: 'checkbox', label: 'Texture' },
      { id: 'pbr', kind: 'checkbox', label: 'PBR materials' },
      { id: 'quad', kind: 'checkbox', label: 'Quad topology (for rigging)' },
      { id: 'faceLimit', kind: 'number', label: 'Face limit (0 = auto)', step: '1000', min: 0, advanced: true },
      { id: 'modelSeed', kind: 'number', label: 'Seed', step: '1', min: 0, advanced: true },
      {
        id: 'textureQuality',
        kind: 'select',
        label: 'Texture quality',
        options: [
          { value: 'standard', label: 'standard' },
          { value: 'detailed', label: 'detailed' },
        ],
        advanced: true,
      },
      { id: 'baseUrl', kind: 'text', label: 'Base URL', placeholder: DEFAULT_TRIPO_BASE, advanced: true },
      { id: 'pollSeconds', kind: 'number', label: 'Poll every (s)', step: '1', min: 1, advanced: true },
      { id: 'timeoutSeconds', kind: 'number', label: 'Give up after (s)', step: '30', min: 30, advanced: true },
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      modelVersion: 'v3.1-20260211',
      texture: true,
      pbr: true,
      quad: false,
      faceLimit: 0,
      modelSeed: 0,
      textureQuality: 'standard',
      baseUrl: DEFAULT_TRIPO_BASE,
      pollSeconds: 5,
      timeoutSeconds: 600,
    },
    async run({ data, inputs, signal, keystore, log, setStatus, setData }) {
      const apiKey = keystore.require(data.credential, 'Tripo key');
      const baseUrl = data.baseUrl || DEFAULT_TRIPO_BASE;
      const file = await resolveFile({ imageUrl: inputs.image?.url, baseUrl, apiKey, signal, log });

      const body = {
        type: 'image_to_model',
        file,
        model_version: data.modelVersion,
        texture: data.texture !== false,
        pbr: data.pbr !== false,
        texture_quality: data.textureQuality || 'standard',
      };
      if (Number(data.faceLimit) > 0) body.face_limit = Number(data.faceLimit);
      if (Number(data.modelSeed) > 0) body.model_seed = Number(data.modelSeed);
      if (data.quad) body.quad = true;

      log(`POST /task image_to_model (${data.modelVersion})`);
      const taskId = await createTask({ baseUrl, apiKey, body, signal });
      log(`task ${taskId} queued`);

      const every = Math.max(1, Number(data.pollSeconds) || 5) * 1000;
      const deadline = Date.now() + (Number(data.timeoutSeconds) || 600) * 1000;

      for (let attempt = 1; ; attempt += 1) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for Tripo task ${taskId}.`);
        await sleep(every, signal);
        const task = await getTask({ baseUrl, apiKey, taskId, signal });
        const status = String(task.status ?? 'unknown').toLowerCase();
        const progress = typeof task.progress === 'number' ? ` ${task.progress}%` : '';
        setStatus(`${status}${progress}`);

        if (TERMINAL_OK.includes(status)) {
          const output = task.output ?? {};
          const modelUrl = output.pbr_model || output.base_model || output.model;
          if (!modelUrl) throw new Error('Tripo finished but returned no model URL.');
          const model = media('model3d', modelUrl, { mime: 'model/gltf-binary', name: `tripo-${taskId}.glb` });
          const render = output.rendered_image ? media('image', output.rendered_image) : null;
          setData({ _result: model });
          log('mesh ready' + (render ? ' (with rendered preview)' : ''));
          return { model, render, json: task };
        }
        if (TERMINAL_BAD.includes(status)) {
          throw new Error(`Tripo task ${status}${task.message ? `: ${task.message}` : ''}.`);
        }
        if (attempt === 1 || attempt % 6 === 0) log(`task ${taskId}: ${status}${progress}`);
      }
    },
  });
}
