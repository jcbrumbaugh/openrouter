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
