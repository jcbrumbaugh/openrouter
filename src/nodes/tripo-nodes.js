// Tripo: hosted image-to-3D, plus the follow-up tasks that operate on a mesh
// you already generated (convert, re-texture, stylize).

import { asText, media } from '../core/types.js';
import { dataUrlToBlob, fetchViaGateway } from '../util/media.js';
import { describeMesh, inspectGlb, sniffMesh } from '../util/glb.js';
import { DEFAULT_GATEWAY, gatewayOrigin } from '../providers/gateway.js';
import { requireKeyFor } from '../providers/keyshapes.js';
import {
  DEFAULT_TRIPO_BASE,
  TRIPO_MODEL_VERSIONS,
  createTask,
  pollTask,
  uploadImage,
} from '../providers/tripo.js';

const VIEWS = ['front', 'left', 'back', 'right'];

// Tripo takes a public URL as-is; a local upload has to go through /upload first.
async function resolveFile({ imageUrl, baseUrl, apiKey, signal, log }) {
  if (/^https?:\/\//i.test(imageUrl)) {
    return { type: /\.png(\?|$)/i.test(imageUrl) ? 'png' : 'jpg', url: imageUrl };
  }
  if (imageUrl.startsWith('data:')) {
    const { blob, extension } = dataUrlToBlob(imageUrl);
    log('uploading image to Tripo');
    const token = await uploadImage({ baseUrl, apiKey, blob, filename: `input.${extension}`, signal });
    return { type: extension === 'png' ? 'png' : 'jpg', file_token: token };
  }
  throw new Error('That image is neither a URL nor uploadable data.');
}

// Provider CDNs serve no CORS headers, so a mesh has to come through the local
// gateway before the page can display it. Falls back to the remote URL, which
// still downloads even when it cannot be previewed.
// `stem` is the file name without an extension: the real extension comes from
// the bytes, because the format depends on options (glTF cannot store quads, so
// asking for quad topology yields FBX or OBJ instead).
async function localiseMesh({ url, baseUrl, stem, signal, log }) {
  try {
    const { url: blobUrl, buffer } = await fetchViaGateway(url, gatewayOrigin(baseUrl), signal);
    const sniffed = sniffMesh(buffer, url);
    const glbInfo = sniffed.ext === 'glb' ? inspectGlb(buffer) : null;
    log(`mesh downloaded (${describeMesh(sniffed, glbInfo)})`);
    if (!sniffed.previewable) {
      log(`${sniffed.label} cannot be shown in the browser - the download link gives you the file`, 'warn');
    }
    return media('model3d', blobUrl, {
      mime: sniffed.ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
      name: `${stem}.${sniffed.ext}`,
      sourceUrl: url,
      format: sniffed.label,
      previewable: sniffed.previewable,
      info: glbInfo ?? undefined,
    });
  } catch (err) {
    log(`could not bring the mesh local, preview will be download-only: ${err.message}`, 'warn');
    return media('model3d', url, { name: `${stem}.glb`, sourceUrl: url, previewable: false });
  }
}

function pickModelUrl(output = {}) {
  return output.pbr_model || output.base_model || output.model || output.model_url || null;
}

const sharedFields = (defaultBase) => [
  { id: 'baseUrl', kind: 'text', label: 'Base URL', placeholder: defaultBase, advanced: true },
  { id: 'pollSeconds', kind: 'number', label: 'Poll every (s)', step: '1', min: 1, advanced: true },
  { id: 'timeoutSeconds', kind: 'number', label: 'Give up after (s)', step: '30', min: 30, advanced: true },
];

export function registerTripoNodes(registry) {
  registry.register({
    type: 'tripo-3d',
    title: 'Tripo 3D',
    category: '3D',
    accent: '#5ed3c4',
    hint: 'Image to 3D. Connect more than one view for a multiview reconstruction.',
    inputs: [
      { id: 'front', label: 'Front', type: 'image', required: true },
      { id: 'left', label: 'Left', type: 'image' },
      { id: 'back', label: 'Back', type: 'image' },
      { id: 'right', label: 'Right', type: 'image' },
    ],
    outputs: [
      { id: 'model', label: 'Model', type: 'model3d' },
      { id: 'render', label: 'Render', type: 'image' },
      { id: 'taskId', label: 'Task', type: 'text' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'Tripo key', provider: 'tripo' },
      { id: 'modelVersion', kind: 'select', label: 'Model', options: TRIPO_MODEL_VERSIONS },
      { id: 'texture', kind: 'checkbox', label: 'Texture' },
      { id: 'pbr', kind: 'checkbox', label: 'PBR materials' },
      { id: 'quad', kind: 'checkbox', label: 'Quad topology - better for rigging, but returns FBX so it cannot preview here' },
      { id: 'modelSeed', kind: 'number', label: 'Seed (0 = random each run)', step: '1', min: 0 },
      {
        id: 'faceLimit',
        kind: 'range',
        label: 'Polygon budget (faces)',
        min: 0,
        max: 300000,
        step: 5000,
        zeroLabel: 'auto',
      },
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
      {
        id: 'geometryQuality',
        kind: 'select',
        label: 'Geometry quality',
        options: [
          { value: 'standard', label: 'standard' },
          { value: 'detailed', label: 'detailed' },
        ],
        advanced: true,
      },
      ...sharedFields(DEFAULT_TRIPO_BASE),
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      modelVersion: 'v3.1-20260211',
      texture: true,
      pbr: true,
      quad: false,
      modelSeed: 0,
      faceLimit: 0,
      textureQuality: 'standard',
      geometryQuality: 'standard',
      baseUrl: DEFAULT_TRIPO_BASE,
      pollSeconds: 5,
      timeoutSeconds: 600,
    },
    async run({ data, inputs, signal, keystore, log, setStatus, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'tripo');
      const baseUrl = data.baseUrl || DEFAULT_TRIPO_BASE;

      const connected = VIEWS.filter((view) => inputs[view]?.url);
      if (!connected.includes('front')) throw new Error('Connect an image to the Front input.');
      const multiview = connected.length > 1;

      if (multiview && data.modelVersion.startsWith('Turbo')) {
        throw new Error('Turbo does not accept multiple views. Pick v2.5 or newer, or connect only the Front image.');
      }

      const body = {
        model_version: data.modelVersion,
        texture: data.texture !== false,
        pbr: data.pbr !== false,
        texture_quality: data.textureQuality || 'standard',
        geometry_quality: data.geometryQuality || 'standard',
      };
      if (Number(data.faceLimit) > 0) body.face_limit = Number(data.faceLimit);
      if (Number(data.modelSeed) > 0) body.model_seed = Number(data.modelSeed);
      if (data.quad) body.quad = true;

      if (multiview) {
        // Position carries meaning: [front, left, back, right], null for a view
        // that is not supplied.
        const files = [];
        for (const view of VIEWS) {
          files.push(
            inputs[view]?.url
              ? await resolveFile({ imageUrl: inputs[view].url, baseUrl, apiKey, signal, log })
              : null,
          );
        }
        while (files.length && files[files.length - 1] === null) files.pop();
        body.type = 'multiview_to_model';
        body.files = files;
        log(`POST /task multiview_to_model (${connected.join(', ')})`);
      } else {
        body.type = 'image_to_model';
        body.file = await resolveFile({ imageUrl: inputs.front.url, baseUrl, apiKey, signal, log });
        log(`POST /task image_to_model (${data.modelVersion})`);
      }

      const taskId = await createTask({ baseUrl, apiKey, body, signal });
      log(`task ${taskId} queued`);

      const task = await pollTask({
        baseUrl,
        apiKey,
        taskId,
        signal,
        everyMs: Math.max(1, Number(data.pollSeconds) || 5) * 1000,
        timeoutMs: (Number(data.timeoutSeconds) || 600) * 1000,
        onTick: (status, progress, attempt) => {
          setStatus(`${status}${typeof progress === 'number' ? ` ${progress}%` : ''}`);
          if (attempt === 1 || attempt % 6 === 0) log(`task ${taskId}: ${status}`);
        },
        onRetry: (err, attempt, delay) => {
          log(`status check failed (${err.message}) - retrying in ${delay / 1000}s, the job is still running`, 'warn');
        },
      });

      const modelUrl = pickModelUrl(task.output);
      if (!modelUrl) throw new Error('Tripo finished but returned no model URL.');
      const model = await localiseMesh({ url: modelUrl, baseUrl, stem: `tripo-${taskId}`, signal, log });
      const render = task.output?.rendered_image ? media('image', task.output.rendered_image) : null;
      setData({ _result: model });
      return { model, render, taskId, json: task };
    },
  });

  registry.register({
    type: 'tripo-post',
    title: 'Tripo Refine',
    category: '3D',
    accent: '#5ed3c4',
    hint: 'Runs on a mesh you already made: export a format, re-texture it, or stylize it.',
    inputs: [
      { id: 'taskId', label: 'Task', type: 'text', required: true },
      { id: 'prompt', label: 'Prompt', type: 'text' },
    ],
    outputs: [
      { id: 'model', label: 'Model', type: 'model3d' },
      { id: 'taskId', label: 'Task', type: 'text' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'credential', kind: 'credential', label: 'Tripo key', provider: 'tripo' },
      {
        id: 'mode',
        kind: 'select',
        label: 'What to do',
        options: [
          { value: 'convert_model', label: 'Export another format' },
          { value: 'texture_model', label: 'Re-texture' },
          { value: 'stylize_model', label: 'Stylize' },
        ],
      },
      {
        id: 'format',
        kind: 'select',
        label: 'Format',
        options: [
          { value: 'GLTF', label: 'GLTF / GLB' },
          { value: 'USDZ', label: 'USDZ (Apple AR)' },
          { value: 'FBX', label: 'FBX (Blender, Unreal)' },
          { value: 'OBJ', label: 'OBJ' },
          { value: 'STL', label: 'STL (printing)' },
          { value: '3MF', label: '3MF (printing)' },
        ],
        showWhen: { mode: 'convert_model' },
      },
      {
        id: 'style',
        kind: 'select',
        label: 'Style',
        options: [
          { value: 'lego', label: 'Lego' },
          { value: 'voxel', label: 'Voxel' },
          { value: 'voronoi', label: 'Voronoi' },
          { value: 'minecraft', label: 'Minecraft' },
        ],
        showWhen: { mode: 'stylize_model' },
      },
      { id: 'quad', kind: 'checkbox', label: 'Quad topology', showWhen: { mode: 'convert_model' } },
      {
        id: 'faceLimit',
        kind: 'range',
        label: 'Polygon budget (faces)',
        min: 0,
        max: 300000,
        step: 5000,
        zeroLabel: 'auto',
        showWhen: { mode: 'convert_model' },
      },
      { id: 'textureSize', kind: 'number', label: 'Texture size', step: '512', min: 512, advanced: true, showWhen: { mode: 'convert_model' } },
      { id: 'pbr', kind: 'checkbox', label: 'PBR materials', showWhen: { mode: 'texture_model' } },
      { id: 'textureSeed', kind: 'number', label: 'Texture seed (0 = random)', step: '1', min: 0, showWhen: { mode: 'texture_model' } },
      ...sharedFields(DEFAULT_TRIPO_BASE),
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      credential: '',
      mode: 'convert_model',
      format: 'GLTF',
      style: 'lego',
      quad: false,
      faceLimit: 0,
      textureSize: 4096,
      pbr: true,
      textureSeed: 0,
      baseUrl: DEFAULT_TRIPO_BASE,
      pollSeconds: 5,
      timeoutSeconds: 600,
    },
    async run({ data, inputs, signal, keystore, log, setStatus, setData }) {
      const apiKey = requireKeyFor(keystore, data.credential, 'tripo');
      const baseUrl = data.baseUrl || DEFAULT_TRIPO_BASE;
      const source = asText(inputs.taskId).trim();
      if (!source) throw new Error('Connect the Task output of a Tripo 3D node.');

      const body = { type: data.mode, original_model_task_id: source };
      if (data.mode === 'convert_model') {
        body.format = data.format;
        body.texture_size = Number(data.textureSize) || 4096;
        if (data.quad) body.quad = true;
        if (Number(data.faceLimit) > 0) body.face_limit = Number(data.faceLimit);
      } else if (data.mode === 'stylize_model') {
        body.style = data.style;
      } else {
        body.texture = true;
        body.pbr = data.pbr !== false;
        if (Number(data.textureSeed) > 0) body.texture_seed = Number(data.textureSeed);
        const prompt = asText(inputs.prompt).trim();
        if (prompt) body.text_prompt = prompt;
      }

      log(`POST /task ${data.mode} on ${source}`);
      const taskId = await createTask({ baseUrl, apiKey, body, signal });
      const task = await pollTask({
        baseUrl,
        apiKey,
        taskId,
        signal,
        everyMs: Math.max(1, Number(data.pollSeconds) || 5) * 1000,
        timeoutMs: (Number(data.timeoutSeconds) || 600) * 1000,
        onTick: (status, progress, attempt) => {
          setStatus(`${status}${typeof progress === 'number' ? ` ${progress}%` : ''}`);
          if (attempt === 1 || attempt % 6 === 0) log(`task ${taskId}: ${status}`);
        },
        onRetry: (err, attempt, delay) => {
          log(`status check failed (${err.message}) - retrying in ${delay / 1000}s, the job is still running`, 'warn');
        },
      });

      const modelUrl = pickModelUrl(task.output);
      if (!modelUrl) throw new Error('Tripo finished but returned no model URL.');
      const model = await localiseMesh({ url: modelUrl, baseUrl, stem: `tripo-${taskId}`, signal, log });
      setData({ _result: model });
      return { model, taskId, json: task };
    },
  });
}
