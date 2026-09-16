// Hunyuan3D 2.1 (image -> 3D mesh).
//
// Unlike the OpenRouter nodes this talks to a server *you* run: the FastAPI app
// in Tencent-Hunyuan/Hunyuan3D-2.1 (`python api_server.py`, port 8081). That
// server sets CORS allow_origins=["*"], so the browser can call it directly.
// The contract below is taken from its api_server.py / api_models.py:
//
//   POST /send          {image, texture, seed, ...}  -> {uid}
//   GET  /status/{uid}  -> {status: processing|texturing|completed|error,
//                           model_base64?, message?}
//   POST /generate      same body, responds with the GLB file itself
//   GET  /health        -> {status: 'healthy'}

import { media } from '../core/types.js';
import { base64ToObjectUrl, toDataUrl } from '../util/media.js';

const DEFAULT_SERVER = 'http://localhost:8081';

function serverUrl(data, path) {
  const base = (data.serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function buildBody(data, imageDataUrl) {
  return {
    image: imageDataUrl,
    remove_background: data.removeBackground !== false,
    texture: Boolean(data.texture),
    seed: Number(data.seed) || 1234,
    octree_resolution: Number(data.octreeResolution) || 256,
    num_inference_steps: Number(data.steps) || 5,
    guidance_scale: Number(data.guidance) || 5.0,
    num_chunks: Number(data.numChunks) || 8000,
    face_count: Number(data.faceCount) || 40000,
    type: 'glb',
  };
}

function unreachable(url, err) {
  return new Error(
    `Could not reach the Hunyuan3D server at ${url}. Start it with "python api_server.py" on a CUDA machine, and if it is not on this computer put its address in Server URL. (${err.message})`,
  );
}

export function registerHunyuan3dNodes(registry) {
  registry.register({
    type: 'hy3d',
    title: 'Hunyuan3D 2.1',
    category: '3D',
    accent: '#f087b8',
    hint: 'Turns one image into a 3D mesh using a Hunyuan3D server you run yourself.',
    inputs: [{ id: 'image', label: 'Image', type: 'image', required: true }],
    outputs: [
      { id: 'model', label: 'Model', type: 'model3d' },
      { id: 'json', label: 'JSON', type: 'json' },
    ],
    fields: [
      { id: 'serverUrl', kind: 'text', label: 'Server URL', placeholder: DEFAULT_SERVER },
      { id: 'texture', kind: 'checkbox', label: 'Generate PBR texture (needs ~29 GB VRAM)' },
      { id: 'removeBackground', kind: 'checkbox', label: 'Remove background first' },
      {
        id: 'mode',
        kind: 'select',
        label: 'Call style',
        options: [
          { value: 'async', label: 'Submit + poll (/send)' },
          { value: 'sync', label: 'Single request (/generate)' },
        ],
      },
      { id: 'seed', kind: 'number', label: 'Seed', step: '1', min: 0 },
      { id: 'steps', kind: 'number', label: 'Steps', step: '1', min: 1, advanced: true },
      { id: 'guidance', kind: 'number', label: 'Guidance', step: '0.5', min: 0, advanced: true },
      { id: 'octreeResolution', kind: 'number', label: 'Octree resolution', step: '1', advanced: true },
      { id: 'faceCount', kind: 'number', label: 'Max faces', step: '1000', advanced: true },
      { id: 'numChunks', kind: 'number', label: 'Chunks', step: '1000', advanced: true },
      { id: 'pollSeconds', kind: 'number', label: 'Poll every (s)', step: '1', min: 1, advanced: true },
      { id: 'timeoutSeconds', kind: 'number', label: 'Give up after (s)', step: '30', min: 30, advanced: true },
      { id: '_result', kind: 'preview', label: '' },
    ],
    defaults: {
      serverUrl: DEFAULT_SERVER,
      texture: false,
      removeBackground: true,
      mode: 'async',
      seed: 1234,
      steps: 5,
      guidance: 5,
      octreeResolution: 256,
      faceCount: 40000,
      numChunks: 8000,
      pollSeconds: 5,
      timeoutSeconds: 900,
    },
    async run({ data, inputs, signal, log, setStatus, setData }) {
      // The server wants a base64 data URL; remote images have to be inlined first.
      const imageDataUrl = await toDataUrl(inputs.image?.url, signal);
      const body = buildBody(data, imageDataUrl);

      if (data.mode === 'sync') {
        const url = serverUrl(data, '/generate');
        log(`POST ${url} (this blocks until the mesh is done)`);
        let response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          throw unreachable(url, err);
        }
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`.slice(0, 300));
        const blob = await response.blob();
        const value = media('model3d', URL.createObjectURL(blob), { mime: 'model/gltf-binary', name: 'hunyuan3d.glb' });
        setData({ _result: value });
        log(`mesh received (${Math.round(blob.size / 1024)} KB)`);
        return { model: value, json: { status: 'completed', bytes: blob.size } };
      }

      const sendUrl = serverUrl(data, '/send');
      log(`POST ${sendUrl}`);
      let submitted;
      try {
        submitted = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw unreachable(sendUrl, err);
      }
      const submitPayload = await submitted.json().catch(() => null);
      if (!submitted.ok) {
        throw new Error(`${submitted.status} ${submitPayload?.message ?? submitPayload?.error ?? 'generation could not start'}`);
      }
      const uid = submitPayload?.uid;
      if (!uid) throw new Error('The server accepted the job but returned no uid to poll.');

      const every = Math.max(1, Number(data.pollSeconds) || 5) * 1000;
      const deadline = Date.now() + (Number(data.timeoutSeconds) || 900) * 1000;
      log(`job ${uid} queued`);

      for (let attempt = 1; ; attempt += 1) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${uid}.`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, every);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });

        const statusUrl = serverUrl(data, `/status/${encodeURIComponent(uid)}`);
        const res = await fetch(statusUrl, { signal });
        const payload = await res.json().catch(() => ({}));
        const status = payload?.status ?? (res.ok ? 'processing' : 'error');
        setStatus(`${status} (${attempt})`);

        if (status === 'completed') {
          if (!payload.model_base64) throw new Error('The job finished but carried no model data.');
          const value = media('model3d', base64ToObjectUrl(payload.model_base64, 'model/gltf-binary'), {
            mime: 'model/gltf-binary',
            name: `hunyuan3d-${uid}.glb`,
          });
          setData({ _result: value });
          log('mesh ready');
          return { model: value, json: { status, uid } };
        }
        if (status === 'error' || !res.ok) {
          throw new Error(payload?.message ?? `Generation failed (${res.status}).`);
        }
        // 'processing' = shape stage, 'texturing' = PBR stage; both mean keep waiting.
        if (attempt === 1 || attempt % 6 === 0) log(`job ${uid}: ${status}`);
      }
    },
  });
}
