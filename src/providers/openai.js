// OpenAI images (gpt-image-1).
//
// Contract taken from the official SDK (openai npm package):
//   POST /v1/images/generations  {model, prompt, n, size, quality, background,
//                                 output_format} -> {data:[{b64_json}]}
//   POST /v1/images/edits        multipart: image, prompt, model, n, size, quality
//
// A ChatGPT subscription does not cover this: API access is billed separately
// from Plus/Pro/Team. The key comes from platform.openai.com.
//
// api.openai.com sends no CORS headers, so baseUrl points at the local gateway.

import { cleanDetail, isRetryableStatus } from '../util/http.js';

export const DEFAULT_OPENAI_BASE = 'http://localhost:8787/openai/v1';

export const IMAGE_SIZES = [
  { value: '1024x1024', label: 'Square 1024' },
  { value: '1536x1024', label: 'Landscape 1536x1024' },
  { value: '1024x1536', label: 'Portrait 1024x1536' },
  { value: 'auto', label: 'Auto' },
];

export const IMAGE_QUALITIES = [
  { value: 'low', label: 'Low (cheapest, fastest)' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'auto', label: 'Auto' },
];

function join(baseUrl, path) {
  return `${(baseUrl || DEFAULT_OPENAI_BASE).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
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
    const detail = cleanDetail(
      payload?.error?.message ?? payload?.message ?? payload?.raw ?? '',
      response.statusText,
    );
    const err = new Error(`${response.status} ${detail}`.trim());
    err.status = response.status;
    if (response.status === 401) {
      err.message += '. OpenAI rejected that key. Note that a ChatGPT subscription does not include API access - the key comes from platform.openai.com and is billed separately.';
    } else if (response.status === 429) {
      err.message += '. Either you are being rate limited, or the API account has no credit (separate from any ChatGPT subscription).';
    } else if (isRetryableStatus(response.status)) {
      err.message += '. That is a fault on OpenAI\'s side rather than anything wrong here.';
    }
    throw err;
  }
  return payload;
}

function unreachable(baseUrl, err) {
  return new Error(
    `Could not reach OpenAI at ${baseUrl}. This needs the local gateway running: "npm run proxy". (${err.message})`,
  );
}

export async function generateImages({ baseUrl, apiKey, body, signal }) {
  let response;
  try {
    response = await fetch(join(baseUrl, '/images/generations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw unreachable(baseUrl || DEFAULT_OPENAI_BASE, err);
  }
  return parse(response);
}

// Editing takes the source image as multipart rather than JSON.
export async function editImages({ baseUrl, apiKey, form, signal }) {
  let response;
  try {
    response = await fetch(join(baseUrl, '/images/edits'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // browser sets the multipart boundary
      body: form,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw unreachable(baseUrl || DEFAULT_OPENAI_BASE, err);
  }
  return parse(response);
}

// gpt-image-1 answers with base64 rather than URLs.
export function imagesFromPayload(payload, format = 'png') {
  const rows = payload?.data ?? [];
  return rows
    .map((row) => {
      if (row?.b64_json) return `data:image/${format};base64,${row.b64_json}`;
      if (row?.url) return row.url;
      return null;
    })
    .filter(Boolean);
}
