// Thin OpenRouter client. Everything goes through request() so the base URL can
// point at openrouter.ai directly or at the local proxy in scripts/proxy.mjs.

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

function joinUrl(baseUrl, path) {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}

function headers(apiKey, extra = {}) {
  const out = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) out.Authorization = `Bearer ${apiKey}`;
  // OpenRouter uses these for attribution on its rankings page; both optional.
  if (typeof location !== 'undefined' && location.origin?.startsWith('http')) {
    out['HTTP-Referer'] = location.origin;
  }
  out['X-Title'] = 'Node Space';
  return out;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function request({
  baseUrl,
  path,
  apiKey,
  method = 'POST',
  body,
  signal,
  extraHeaders,
}) {
  const url = joinUrl(baseUrl, path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: headers(apiKey, extraHeaders),
      body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(
      `Network error calling ${url}. If the browser blocked it as cross-origin, run the bundled proxy (npm run proxy) and set Base URL to http://localhost:8787/api/v1. (${err.message})`,
    );
  }
  const payload = await parseBody(response);
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.error?.metadata?.raw ||
      payload?.message ||
      payload?.raw ||
      response.statusText;
    const err = new Error(`${response.status} ${detail}`.trim());
    if (response.status === 401) {
      err.message += '. That key was rejected - it is usually revoked, mistyped, or from a different account. Open Keys and re-paste it, then use Test.';
    } else if (response.status === 402) {
      err.message += '. Your OpenRouter account is out of credit for this model.';
    } else if (response.status === 404) {
      err.message += '. Check the model slug and the request path (the refresh button next to Model lists what exists).';
    }
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// GET /key reports what a key is, without spending anything - the cheapest way
// to tell "bad key" apart from "bad request".
export function keyInfo({ baseUrl, apiKey, signal } = {}) {
  return request({ baseUrl, path: '/key', apiKey, method: 'GET', signal });
}

export function listModels({ baseUrl, apiKey, signal } = {}) {
  return request({ baseUrl, path: '/models', apiKey, method: 'GET', signal });
}

export function chatCompletion({ baseUrl, apiKey, body, signal }) {
  return request({ baseUrl, path: '/chat/completions', apiKey, method: 'POST', body, signal });
}

// Builds the user message for a chat call, attaching an image part when present.
export function userMessage({ text, imageUrl }) {
  if (!imageUrl) return { role: 'user', content: text ?? '' };
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  parts.push({ type: 'image_url', image_url: { url: imageUrl } });
  return { role: 'user', content: parts };
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
