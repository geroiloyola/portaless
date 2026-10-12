// packages/cloud-images/src/png.ts
//
// Embedding de imagen: chunk privado PNG `pAPW` + sidecar JSON externo
// (el item de EXIF para JPEG queda como trabajo futuro -- ver
// docs/architecture/cloud-images.md).
//
// Reglas PNG (spec 5.4): nombre de chunk de 4 bytes -- primera letra
// minuscula = privado (`p`), segunda mayuscula = reservada (`A`),
// tercera mayuscula = estandard (`P`), cuarta mayuscula = safe-to-copy
// (`W`) -> `pAPW`, siempre antes de IEND. El contenido es el sidecar
// JSON en UTF-8.
//
// El hash del payload (contentHash) se calcula sobre la imagen SIN el
// chunk pAPW: un verificador extrae el chunk, recalcula y compara.
// stripPng() sobre un PNG embebido devuelve los bytes originales
// byte a byte (round-trip que cubren los tests).

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const APW_CHUNK_TYPE = "pAPW";

export type PngEmbedFailure = "not_png" | "png_truncated" | "png_no_iend";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** CRC-32 (polinomio 0xEDB88320) estandar de PNG. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

interface PngChunk {
  type: string;
  start: number; // offset del tipo (despues del length)
  dataEnd: number; // offset final del data
  crcStored: number;
  crcOk: boolean;
}

/** Parsea los chunks validando firma, longitudes y CRC de cada uno.
 *  Lanza png_truncated ante bytes incompletos. */
function parseChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("not_png");
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 0 || offset + 12 + length > bytes.length) throw new Error("png_truncated");
    const typeStart = offset + 4;
    const type = String.fromCharCode(bytes[typeStart], bytes[typeStart + 1], bytes[typeStart + 2], bytes[typeStart + 3]);
    const dataEnd = typeStart + 4 + length;
    const crcStart = dataEnd;
    const crcStored =
      ((bytes[crcStart] << 24) | (bytes[crcStart + 1] << 16) | (bytes[crcStart + 2] << 8) | bytes[crcStart + 3]) >>> 0;
    const forCrc = bytes.subarray(typeStart, dataEnd);
    chunks.push({ type, start: typeStart, dataEnd, crcStored, crcOk: crc32(forCrc) === crcStored });
    offset = crcStart + 4;
    if (type === "IEND") break;
  }
  if (chunks.length === 0 || chunks[chunks.length - 1].type !== "IEND") throw new Error("png_no_iend");
  return chunks;
}

function buildApwChunk(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = 0x70; // p
  out[5] = 0x41; // A
  out[6] = 0x50; // P
  out[7] = 0x57; // W
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

/**
 * Devuelve el PNG con el chunk pAPW reemplazado/insertado antes de IEND.
 * Lanza Error("not_png" | "png_truncated" | "png_no_iend").
 */
export function embedPng(bytes: Uint8Array, sidecarJson: string): Uint8Array {
  const chunks = parseChunks(bytes);
  const iend = chunks[chunks.length - 1];
  const apw = chunks.find((chunk) => chunk.type === APW_CHUNK_TYPE);

  const data = textEncoder.encode(sidecarJson);
  const chunk = buildApwChunk(data);
  if (apw) {
    // reemplaza in-place: [0, apw.start - 4) + chunk + desde fin del viejo
    const oldEnd = apw.dataEnd + 4;
    const out = new Uint8Array(bytes.length - oldEnd + (apw.start - 4) + chunk.length);
    out.set(bytes.subarray(0, apw.start - 4), 0);
    out.set(chunk, apw.start - 4);
    out.set(bytes.subarray(oldEnd), apw.start - 4 + chunk.length);
    return out;
  }
  const insertAt = iend.start - 4;
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return out;
}

/**
 * Extrae el JSON del chunk pAPW. null = sin chunk (o chunk corrupto:
 * CRC invalido se trata como ausente -- el verificador ve "sin sidecar",
 * nunca datos de confianza desde un chunk ilegible).
 */
export function extractPng(bytes: Uint8Array): string | null {
  let chunks: PngChunk[];
  try {
    chunks = parseChunks(bytes);
  } catch {
    return null;
  }
  const apw = chunks.find((chunk) => chunk.type === APW_CHUNK_TYPE);
  if (!apw || !apw.crcOk) return null;
  try {
    return textDecoder.decode(bytes.subarray(apw.start + 4, apw.dataEnd));
  } catch {
    return null;
  }
}

/**
 * PNG sin el chunk pAPW (los bytes sobre los que se calcula el
 * contentHash). Si no hay chunk, devuelve los bytes tal cual.
 */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const chunks = parseChunks(bytes);
  const apw = chunks.find((chunk) => chunk.type === APW_CHUNK_TYPE);
  if (!apw) return bytes.slice();
  const oldEnd = apw.dataEnd + 4;
  const out = new Uint8Array(bytes.length - (oldEnd - (apw.start - 4)));
  out.set(bytes.subarray(0, apw.start - 4), 0);
  out.set(bytes.subarray(oldEnd), apw.start - 4);
  return out;
}
