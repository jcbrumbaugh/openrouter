// Port types and the value conventions that travel along edges.
//
//   text   -> string
//   image  -> { type:'image', url, mime? }      url may be https: or data:
//   video  -> { type:'video', url, mime?, poster? }
//   model3d-> { type:'model3d', url, mime?, name? }   url is usually a blob:
//   json   -> any JSON-ish value
//   number -> number
//   any    -> anything (wildcard, connects to/from everything)

export const PORT_COLORS = {
  text: '#7dd3a0',
  image: '#f0a868',
  video: '#c49bff',
  model3d: '#f087b8',
  json: '#69b7f0',
  number: '#e4d072',
  any: '#9aa3b2',
};

export function canConnect(fromType, toType) {
  if (!fromType || !toType) return false;
  if (fromType === toType) return true;
  if (fromType === 'any' || toType === 'any') return true;
  // Anything renders as text in a pinch; text also feeds json bodies.
  if (toType === 'json') return true;
  if (toType === 'text' && (fromType === 'number' || fromType === 'json')) return true;
  if (toType === 'number' && fromType === 'text') return true;
  return false;
}

export function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    if (value.type === 'image' || value.type === 'video' || value.type === 'model3d') return value.url ?? '';
    if (typeof value.text === 'string') return value.text;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function asNumber(value) {
  const n = typeof value === 'number' ? value : Number(asText(value));
  return Number.isFinite(n) ? n : 0;
}

export function media(type, url, extra = {}) {
  return { type, url, ...extra };
}
