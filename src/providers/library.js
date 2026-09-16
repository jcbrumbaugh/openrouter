// The local library lives in the project's my-work/ folder and is reached
// through the gateway, which is the only thing here that can touch disk.

import { getGateway } from './gateway.js';

export const LIBRARY_KINDS = ['models', 'videos', 'images', 'graphs'];

function endpoint(pathname, origin = getGateway()) {
  return `${origin.replace(/\/+$/, '')}${pathname}`;
}

async function send(pathname, { method = 'GET', body, origin, signal } = {}) {
  let response;
  try {
    response = await fetch(endpoint(pathname, origin), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('The library needs the local gateway running - start it with start.command (or npm run proxy).');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? `library error ${response.status}`);
  return payload;
}

export const listLibrary = (origin) => send('/library/list', { origin });

export const saveToLibrary = (item, origin, signal) =>
  send('/library/save', { method: 'POST', body: item, origin, signal });

export const updateMeta = (rel, meta, origin) =>
  send('/library/meta', { method: 'PATCH', body: { rel, meta }, origin });

export const removeFromLibrary = (rel, origin) =>
  send(`/library/item?rel=${encodeURIComponent(rel)}`, { method: 'DELETE', origin });

// A URL the page can use to display something already saved.
export function fileUrl(rel, origin = getGateway()) {
  const [kind, ...rest] = rel.split('/');
  return endpoint(`/library/file/${kind}/${encodeURIComponent(rest.join('/'))}`, origin);
}

export function kindFor(value) {
  if (value?.type === 'model3d') return 'models';
  if (value?.type === 'video') return 'videos';
  if (value?.type === 'image') return 'images';
  return 'images';
}
