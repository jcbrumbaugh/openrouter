// Reads the header of a binary glTF so a failed preview can say *why* it
// failed. A .glb is: a 12-byte header, then chunks; the first chunk is the
// glTF JSON, which lists the extensions a loader must understand.

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

export function inspectGlb(arrayBuffer) {
  const info = {
    isGlb: false,
    version: null,
    byteLength: arrayBuffer.byteLength,
    extensionsUsed: [],
    extensionsRequired: [],
    generator: null,
    error: null,
  };
  try {
    if (arrayBuffer.byteLength < 20) {
      info.error = 'file is too small to be a mesh';
      return info;
    }
    const header = new DataView(arrayBuffer, 0, 12);
    if (header.getUint32(0, true) !== MAGIC) {
      // Could still be a text .gltf or a JSON error page.
      const peek = Math.min(64, arrayBuffer.byteLength);
      const start = new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, peek)).trim();
      info.error = start.startsWith('{') ? 'server returned JSON, not a mesh' : 'not a binary glTF file';
      return info;
    }
    info.isGlb = true;
    info.version = header.getUint32(4, true);

    const chunkHeader = new DataView(arrayBuffer, 12, 8);
    const chunkLength = chunkHeader.getUint32(0, true);
    if (chunkHeader.getUint32(4, true) !== JSON_CHUNK) return info;

    // The JSON chunk is padded to a 4-byte boundary, so trim the filler before
    // parsing (the spec pads with spaces, but not every exporter obeys that).
    const raw = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, chunkLength))
      .replace(/[\0\s]+$/, '');
    const json = JSON.parse(raw);
    info.extensionsUsed = json.extensionsUsed ?? [];
    info.extensionsRequired = json.extensionsRequired ?? [];
    info.generator = json.asset?.generator ?? null;
  } catch (err) {
    info.error = `could not read the mesh header: ${err.message}`;
  }
  return info;
}

// Extensions that need a separate decoder the viewer fetches at runtime, which
// is the usual reason a perfectly good mesh will not display.
const DECODER_EXTENSIONS = {
  KHR_draco_mesh_compression: 'Draco compression',
  EXT_meshopt_compression: 'meshopt compression',
  KHR_texture_basisu: 'Basis/KTX2 textures',
};

export function decodersNeeded(info) {
  return (info.extensionsRequired ?? [])
    .filter((name) => name in DECODER_EXTENSIONS)
    .map((name) => DECODER_EXTENSIONS[name]);
}

// What actually came down the wire. Providers return whatever format suits the
// options you picked - notably, glTF can only store triangles, so asking for
// quad topology forces a different format - and calling every result ".glb"
// hides that.
const SIGNATURES = [
  { ext: 'glb', label: 'binary glTF', previewable: true, test: (b) => ascii(b, 0, 4) === 'glTF' },
  { ext: 'fbx', label: 'Autodesk FBX', previewable: false, test: (b) => ascii(b, 0, 18) === 'Kaydara FBX Binary' },
  { ext: 'zip', label: 'zip archive', previewable: false, test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7) },
  { ext: 'usdc', label: 'USD (binary)', previewable: false, test: (b) => ascii(b, 0, 8) === 'PXR-USDC' },
  { ext: 'usda', label: 'USD (text)', previewable: false, test: (b) => ascii(b, 0, 5) === '#usda' },
  { ext: 'ply', label: 'PLY', previewable: false, test: (b) => ascii(b, 0, 3) === 'ply' },
  { ext: 'stl', label: 'STL (text)', previewable: false, test: (b) => ascii(b, 0, 6).toLowerCase() === 'solid ' },
  { ext: 'gltf', label: 'glTF (JSON)', previewable: false, test: (b) => ascii(b, 0, 1) === '{' },
  { ext: 'obj', label: 'OBJ', previewable: false, test: (b) => /^(#|v |o |g |mtllib|usemtl)/.test(ascii(b, 0, 8)) },
  { ext: 'fbx', label: 'Autodesk FBX (text)', previewable: false, test: (b) => /^;\s*FBX/i.test(ascii(b, 0, 10)) },
];

function ascii(bytes, start, length) {
  let out = '';
  for (let i = start; i < Math.min(start + length, bytes.length); i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function sniffMesh(arrayBuffer, urlHint = '') {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(64, arrayBuffer.byteLength));
  const match = SIGNATURES.find((sig) => {
    try {
      return sig.test(bytes);
    } catch {
      return false;
    }
  });
  if (match) return { ...match, bytes: arrayBuffer.byteLength };

  // Nothing recognised: fall back to whatever the URL claims, and show the
  // leading bytes so the mystery is at least describable.
  const fromUrl = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(urlHint)?.[1]?.toLowerCase();
  return {
    ext: fromUrl ?? 'bin',
    label: fromUrl ? `${fromUrl.toUpperCase()} (by file name)` : 'unrecognised format',
    previewable: false,
    bytes: arrayBuffer.byteLength,
    head: [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '),
  };
}

export function describeMesh(sniffed, glbInfo) {
  const size = `${Math.round(sniffed.bytes / 1024)} KB`;
  if (sniffed.ext === 'glb' && glbInfo && !glbInfo.error) {
    const decoders = decodersNeeded(glbInfo);
    return [size, `glTF ${glbInfo.version ?? '?'}`, decoders.length ? `needs ${decoders.join(' + ')}` : null]
      .filter(Boolean)
      .join(', ');
  }
  return [size, sniffed.label, sniffed.head ? `starts with ${sniffed.head}` : null].filter(Boolean).join(', ');
}

export function describeGlb(info) {
  if (info.error) return info.error;
  const bits = [`${Math.round(info.byteLength / 1024)} KB`];
  if (info.isGlb) bits.push(`glTF ${info.version ?? '?'}`);
  const decoders = decodersNeeded(info);
  if (decoders.length) bits.push(`needs ${decoders.join(' + ')}`);
  else if (info.extensionsRequired?.length) bits.push(`requires ${info.extensionsRequired.join(', ')}`);
  return bits.join(', ');
}
