// Runway client (api.dev.runwayml.com).
//
// Contract taken from Runway's official SDK (@runwayml/sdk 4.20.0):
//   POST /v1/image_to_video  {model, promptImage, promptText, ratio, duration, seed}
//                            -> {id}
//   GET  /v1/tasks/{id}      -> {status, output:[url], failure?}
//   statuses: PENDING | THROTTLED | RUNNING | SUCCEEDED | FAILED | CANCELLED
//   headers: Authorization: Bearer <key>, X-Runway-Version: 2024-11-06
//
// That SDK refuses to run in a browser at all, and the API sends no CORS
// headers, so baseUrl points at the local gateway in scripts/proxy.mjs.

import { cleanDetail, isRetryableStatus, withRetry } from '../util/http.js';

export const DEFAULT_RUNWAY_BASE = 'http://localhost:8787/runway';
export const RUNWAY_API_VERSION = '2024-11-06';

// From the SDK's image_to_video model union.
export const RUNWAY_VIDEO_MODELS = [
  { value: 'seedance2_5', label: 'Seedance 2.5' },
  { value: 'seedance2', label: 'Seedance 2' },
  { value: 'seedance2_fast', label: 'Seedance 2 fast' },
  { value: 'seedance2_mini', label: 'Seedance 2 mini' },
  { value: 'gen4.5', label: 'Runway Gen-4.5' },
  { value: 'gen4_turbo', label: 'Runway Gen-4 Turbo' },
  { value: 'veo3.1', label: 'Veo 3.1' },
  { value: 'veo3.1_fast', label: 'Veo 3.1 fast' },
  { value: 'hailuo3', label: 'Hailuo 3' },
  { value: 'wan3', label: 'Wan 3' },
];

// Runway takes explicit pixel ratios rather than "16:9".
export const RUNWAY_RATIOS = [
  { value: '1280:720', label: '1280x720 (16:9)' },
  { value: '1920:1080', label: '1920x1080 (16:9)' },
  { value: '720:1280', label: '720x1280 (9:16)' },
  { value: '1080:1920', label: '1080x1920 (9:16)' },
  { value: '1440:1440', label: '1440x1440 (1:1)' },
  { value: '1104:832', label: '1104x832 (4:3)' },
];

export const RUNWAY_DONE = 'SUCCEEDED';
export const RUNWAY_BAD = ['FAILED', 'CANCELLED'];

function join(baseUrl, path) {
  return `${(baseUrl || DEFAULT_RUNWAY_BASE).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function headers(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Runway-Version': RUNWAY_API_VERSION,
  };
}

async function parse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const raw = payload?.error ?? payload?.message ?? payload?.raw ?? '';
    const detail = cleanDetail(typeof raw === 'string' ? raw : JSON.stringify(raw), response.statusText);
    const err = new Error(`${response.status} ${detail}`.trim());
    err.status = response.status;
    if (response.status === 401) err.message += '. Runway rejected that key - check it at dev.runwayml.com.';
    else if (response.status === 429) err.message += '. Runway is rate limiting or your credits ran out.';
    else if (isRetryableStatus(response.status)) err.message += '. That is a fault on Runway\'s side rather than anything wrong here.';
    throw err;
  }
  return payload;
}

export async function createImageToVideo({ baseUrl, apiKey, body, signal }) {
  const url = join(baseUrl, '/v1/image_to_video');
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(
      `Could not reach Runway at ${baseUrl || DEFAULT_RUNWAY_BASE}. Runway refuses direct browser calls, so this needs the local gateway running: "npm run proxy". (${err.message})`,
    );
  }
  const payload = await parse(response);
  if (!payload?.id) throw new Error('Runway accepted the request but returned no task id.');
  return payload.id;
}

export async function getTask({ baseUrl, apiKey, taskId, signal, onRetry }) {
  // Safe to repeat, and the generation keeps running on Runway's side.
  return withRetry(async () => {
    const response = await fetch(join(baseUrl, `/v1/tasks/${encodeURIComponent(taskId)}`), {
      headers: headers(apiKey),
      signal,
    });
    return parse(response);
  }, { signal, onRetry, attempts: 4 });
}
