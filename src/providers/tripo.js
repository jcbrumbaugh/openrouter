// Tripo client (api.tripo3d.ai/v2/openapi).
//
// Contract taken from Tripo's own Python SDK (tripo3d 0.4.2):
//   POST /task        {type:'image_to_model', file:{type,url|file_token}, ...}
//                     -> {code, data:{task_id}}
//   GET  /task/{id}   -> {code, data:{status, progress, output:{
//                          base_model, pbr_model, rendered_image}}}
//   POST /upload      multipart field "file" -> {code, data:{image_token|file_token}}
//   statuses: queued | running | success | failed | cancelled | banned | expired
//
// Tripo does not serve CORS headers, so baseUrl normally points at the local
// gateway in scripts/proxy.mjs rather than at Tripo directly.

export const DEFAULT_TRIPO_BASE = 'http://localhost:8787/tripo/v2/openapi';

export const TRIPO_MODEL_VERSIONS = [
  { value: 'v3.1-20260211', label: 'v3.1 (newest)' },
  { value: 'v3.0-20250812', label: 'v3.0' },
  { value: 'P1-20260311', label: 'P1' },
  { value: 'Turbo-v1.0-20250506', label: 'Turbo (fast)' },
  { value: 'v2.5-20250123', label: 'v2.5' },
];

export const TERMINAL_OK = ['success'];
export const TERMINAL_BAD = ['failed', 'cancelled', 'banned', 'expired', 'unknown'];

function join(baseUrl, path) {
  return `${(baseUrl || DEFAULT_TRIPO_BASE).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function parse(response, what) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) {
    const detail = payload?.message ?? payload?.error ?? payload?.raw ?? response.statusText;
    const err = new Error(`${response.status} ${detail}`.trim());
    err.status = response.status;
    err.payload = payload;
    if (response.status === 401 || response.status === 403) {
      err.message += '. Tripo rejected that key - check it at platform.tripo3d.ai.';
    }
    throw err;
  }
  if (!payload) throw new Error(`Tripo returned an empty response for ${what}.`);
  return payload;
}

function networkHint(baseUrl, err) {
  return new Error(
    `Could not reach Tripo at ${baseUrl}. Tripo does not allow direct browser calls, so this needs the local gateway running: "npm run proxy". (${err.message})`,
  );
}

export async function createTask({ baseUrl, apiKey, body, signal }) {
  const url = join(baseUrl, '/task');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw networkHint(baseUrl || DEFAULT_TRIPO_BASE, err);
  }
  const payload = await parse(response, 'task creation');
  const taskId = payload?.data?.task_id;
  if (!taskId) throw new Error('Tripo accepted the request but returned no task_id.');
  return taskId;
}

export async function getTask({ baseUrl, apiKey, taskId, signal }) {
  const response = await fetch(join(baseUrl, `/task/${encodeURIComponent(taskId)}`), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  const payload = await parse(response, 'task status');
  return payload.data ?? {};
}

// Tripo accepts a public URL directly; anything local has to be uploaded first.
export async function uploadImage({ baseUrl, apiKey, blob, filename, signal }) {
  const form = new FormData();
  form.append('file', blob, filename);
  const response = await fetch(join(baseUrl, '/upload'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }, // let the browser set the multipart boundary
    body: form,
    signal,
  });
  const payload = await parse(response, 'image upload');
  const token = payload?.data?.image_token ?? payload?.data?.file_token;
  if (!token) throw new Error('Tripo accepted the upload but returned no image token.');
  return token;
}
