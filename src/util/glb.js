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

export function describeGlb(info) {
  if (info.error) return info.error;
  const bits = [`${Math.round(info.byteLength / 1024)} KB`];
  if (info.isGlb) bits.push(`glTF ${info.version ?? '?'}`);
  const decoders = decodersNeeded(info);
  if (decoders.length) bits.push(`needs ${decoders.join(' + ')}`);
  else if (info.extensionsRequired?.length) bits.push(`requires ${info.extensionsRequired.join(', ')}`);
  return bits.join(', ');
}
