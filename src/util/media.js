// Media plumbing shared by nodes: base64 <-> blob URLs, and inlining a remote
// image so it can be posted to an API that only accepts data URLs.

export function base64ToObjectUrl(base64, mime = 'application/octet-stream') {
  const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Returns `url` untouched when it is already a data URL, otherwise fetches it
// and inlines it. Remote hosts that do not send CORS headers cannot be read by
// the page at all, so say that plainly instead of failing deeper in.
export async function toDataUrl(url, signal) {
  if (!url) throw new Error('No image supplied.');
  if (url.startsWith('data:')) return url;
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(
      `That image lives at ${new URL(url).host} and the browser is not allowed to read it (no CORS headers). Download it and feed it in through an Image node instead.`,
    );
  }
  if (!response.ok) throw new Error(`Could not fetch the input image (${response.status}).`);
  return blobToDataUrl(await response.blob());
}

// Abortable delay used by every polling node.
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// Splits a data URL into a Blob plus a sensible file extension.
export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('That is not a data URL.');
  const [, mime, isBase64, payload] = match;
  const bytes = isBase64
    ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  const extension = (mime.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg').split('+')[0];
  return { blob: new Blob([bytes], { type: mime }), mime, extension };
}

// Pulls a provider asset through the local gateway and hands back a blob URL.
// Needed because provider CDNs (Tripo's mesh host, for one) serve no CORS
// headers: the page can link to those files but cannot read them, so a viewer
// pointed straight at the remote URL silently renders nothing.
export async function fetchViaGateway(url, gatewayOrigin, signal) {
  const endpoint = `${gatewayOrigin.replace(/\/+$/, '')}/fetch?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { signal });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json())?.error?.message ?? detail;
    } catch {
      /* keep the status text */
    }
    throw new Error(`Could not download the result through the gateway: ${detail}`);
  }
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: response.headers.get('content-type') ?? 'application/octet-stream' });
  return { url: URL.createObjectURL(blob), bytes: blob.size, buffer };
}
