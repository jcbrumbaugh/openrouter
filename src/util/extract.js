// Response spelunking. Provider payload shapes vary (and change), so instead of
// hard-coding one schema we walk the JSON for the first thing that looks right.

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;
const URLISH_KEYS = [
  'url', 'video_url', 'videoUrl', 'image_url', 'imageUrl', 'uri', 'src',
  'download_url', 'signed_url', 'output', 'output_url', 'video', 'file_url',
  'asset_url', 'b64_json', 'data',
];

export function walk(value, visit, path = '$') {
  const stop = visit(value, path);
  if (stop === true) return true;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (walk(value[i], visit, `${path}[${i}]`) === true) return true;
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (walk(v, visit, `${path}.${k}`) === true) return true;
    }
  }
  return false;
}

function looksLikeMedia(str, kind) {
  if (typeof str !== 'string' || str.length < 8) return false;
  if (str.startsWith(`data:${kind}/`)) return true;
  if (!/^https?:\/\//i.test(str)) return false;
  return kind === 'video' ? VIDEO_EXT.test(str) : IMAGE_EXT.test(str);
}

// Finds the first media URL of `kind` ('video' | 'image') anywhere in a payload.
export function findMediaUrl(payload, kind) {
  let hit = null;
  walk(payload, (value, path) => {
    if (looksLikeMedia(value, kind)) {
      hit = { url: value, path };
      return true;
    }
    return false;
  });
  if (hit) return hit;

  // Second pass: a url-ish key whose value is a bare URL with no useful extension
  // (signed CDN links often have none).
  walk(payload, (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    for (const key of URLISH_KEYS) {
      const candidate = value[key];
      if (typeof candidate !== 'string') continue;
      if (/^https?:\/\//i.test(candidate) || candidate.startsWith('data:')) {
        hit = { url: candidate, path: `${path}.${key}` };
        return true;
      }
    }
    return false;
  });
  return hit;
}

// Pulls assistant text out of an OpenAI-compatible chat completion, with
// fallbacks for providers that nest content as parts.
export function extractChatText(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message) return typeof payload?.output_text === 'string' ? payload.output_text : '';
  const { content } = message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof message.reasoning === 'string') return message.reasoning;
  return '';
}

// Dotted/bracket path reader: "choices[0].message.content", "$.data.url".
export function getPath(payload, path) {
  if (!path || path === '$' || path === '') return payload;
  const parts = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p !== '');
  let cursor = payload;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

// {{name}} substitution for request-body / prompt templates.
export function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (match, key) => {
    const value = key in vars ? vars[key] : getPath(vars, key);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
