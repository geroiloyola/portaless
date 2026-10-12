// packages/cloud-images/src/png.ts: embedding en chunk privado `pAPW`
// (nombre valido segun la spec 5.4: privado/estandard/safe-to-copy).
// Cubre el round-trip embed -> extract -> strip (strip devuelve los
// bytes originales byte a byte, que es sobre lo que se calcula el
// contentHash), reemplazo de un chunk existente, CRC correcto, y todos
// los fallos: no-png, truncado, sin IEND, CRC corrupto.

import { describe, it, expect } from "vitest";
import { isPng, embedPng, extractPng, stripPng, crc32, PNG_SIGNATURE, APW_CHUNK_TYPE } from "../../packages/cloud-images/src/png";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** PNG minimo valido: firma + IHDR + IDAT + IEND. */
function minimalPng(): Uint8Array {
  return concat(
    PNG_SIGNATURE,
    chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("IDAT", Uint8Array.from([1, 2, 3, 4])),
    chunk("IEND", new Uint8Array(0))
  );
}

const SIDECAR = '{"payload":{"v":1},"jws":"a.b.c"}';

describe("PNG pAPW", () => {
  it("embed -> extract devuelve el sidecar y strip recupera los bytes originales", () => {
    const png = minimalPng();
    expect(isPng(png)).toBe(true);
    expect(extractPng(png)).toBeNull();

    const embedded = embedPng(png, SIDECAR);
    expect(isPng(embedded)).toBe(true);
    expect(extractPng(embedded)).toBe(SIDECAR);
    // el hash se calcula sobre la imagen SIN el chunk: strip == original
    expect(stripPng(embedded)).toEqual(png);
    expect(stripPng(png)).toEqual(png);
  });

  it("embed sobre un PNG ya embebido reemplaza el chunk (sin duplicar)", () => {
    const png = minimalPng();
    const first = embedPng(png, "version-1");
    const second = embedPng(first, "version-2");
    expect(extractPng(second)).toBe("version-2");
    expect(stripPng(second)).toEqual(png);
    // mismo largo que el primer embed (mismo tamano de payload): reemplazo, no duplicado
    expect(second.length).toBe(first.length);
    const third = embedPng(second, "v3");
    expect(extractPng(third)).toBe("v3");
    expect(stripPng(third)).toEqual(png);
  });

  it("rechaza no-png, truncado y sin IEND", () => {
    expect(() => embedPng(Uint8Array.from([1, 2, 3]), SIDECAR)).toThrow("not_png");
    expect(extractPng(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(() => stripPng(Uint8Array.from([1, 2, 3]))).toThrow("not_png");

    const png = minimalPng();
    expect(() => embedPng(png.subarray(0, png.length - 5), SIDECAR)).toThrow();
    expect(() => embedPng(concat(PNG_SIGNATURE, chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]))), SIDECAR)).toThrow("png_no_iend");
  });

  it("CRC corrupto del chunk pAPW -> extract lo trata como ausente", () => {
    const embedded = embedPng(minimalPng(), SIDECAR);
    const corrupted = embedded.slice();
    // el ultimo byte del CRC del pAPW (justo antes de IEND) queda en el
    // byte anterior a la firma de IEND
    corrupted[corrupted.length - 12 - 1] ^= 0xff;
    expect(extractPng(corrupted)).toBeNull();
  });

  it("crc32 coincide con el vector conocido del spec PNG", () => {
    // "IEND" sin data: crc32 del tipo IEND = 0xAE426082
    expect(crc32(new TextEncoder().encode("IEND")) >>> 0).toBe(0xae426082);
    expect(APW_CHUNK_TYPE).toBe("pAPW");
  });
});
