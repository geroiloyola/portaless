// Tests reales de manifest.ts (parseo/validacion/serializacion del
// payload APW) y del resolveApwManifest() de alto nivel en
// packages/apw-resolver/src/index.ts.

import { describe, it, expect, vi } from "vitest";
import {
  buildApwManifest,
  serializeApwManifest,
  parseApwManifest,
  APW_MANIFEST_VERSION,
} from "../../packages/apw-resolver/src/manifest";
import { resolveApwManifest } from "../../packages/apw-resolver/src/index";

describe("buildApwManifest / serializeApwManifest", () => {
  it("construye un manifiesto valido con trustUrl derivado del siteId", () => {
    const manifest = buildApwManifest({ siteId: "mi-sitio", contentKinds: ["text", "image"] });

    expect(manifest.v).toBe(APW_MANIFEST_VERSION);
    expect(manifest.siteId).toBe("mi-sitio");
    expect(manifest.trustUrl).toBe("/trust/mi-sitio");
    expect(manifest.contentKinds).toEqual(["text", "image"]);
  });

  it("serializa a JSON compacto sin espacios", () => {
    const manifest = buildApwManifest({ siteId: "x", contentKinds: ["link"] });
    const serialized = serializeApwManifest(manifest);

    expect(serialized).not.toContain(" ");
    expect(JSON.parse(serialized)).toEqual(manifest);
  });
});

describe("parseApwManifest", () => {
  it("acepta un manifiesto real construido por buildApwManifest", () => {
    const manifest = buildApwManifest({ siteId: "sitio-real", contentKinds: ["product", "mixed"] });
    const result = parseApwManifest(serializeApwManifest(manifest));

    expect(result.valid).toBe(true);
    expect(result.manifest).toEqual(manifest);
  });

  it("rechaza JSON invalido", () => {
    const result = parseApwManifest("esto no es json {");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("not_an_object");
  });

  it("rechaza un array en vez de un objeto", () => {
    const result = parseApwManifest("[1,2,3]");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("not_an_object");
  });

  it("rechaza version faltante o incorrecta", () => {
    const result = parseApwManifest(JSON.stringify({ v: 99, siteId: "x", trustUrl: "/trust/x", contentKinds: ["text"] }));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("missing_or_invalid_version");
  });

  it("rechaza siteId vacio", () => {
    const result = parseApwManifest(JSON.stringify({ v: 1, siteId: "", trustUrl: "/trust/x", contentKinds: ["text"] }));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("missing_or_invalid_siteId");
  });

  it("rechaza trustUrl que no empieza con /trust/", () => {
    const result = parseApwManifest(JSON.stringify({ v: 1, siteId: "x", trustUrl: "/otra-cosa/x", contentKinds: ["text"] }));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("missing_or_invalid_trustUrl");
  });

  it("rechaza contentKinds vacio", () => {
    const result = parseApwManifest(JSON.stringify({ v: 1, siteId: "x", trustUrl: "/trust/x", contentKinds: [] }));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("empty_contentKinds");
  });

  it("rechaza un valor de contentKind fuera del enum permitido", () => {
    const result = parseApwManifest(
      JSON.stringify({ v: 1, siteId: "x", trustUrl: "/trust/x", contentKinds: ["text", "video"] })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_contentKind_value");
  });
});

describe("resolveApwManifest (integracion dns-txt + manifest)", () => {
  function mockDoh(fetchSpy: ReturnType<typeof vi.fn>, txtValue: string) {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ name: "_apw.example.com.", type: 16, TTL: 300, data: `"${txtValue.replace(/"/g, '\\"')}"` }],
      }),
    });
  }

  it("resuelve end-to-end un manifiesto valido publicado por un sitio", async () => {
    const manifest = buildApwManifest({ siteId: "sitio-e2e", contentKinds: ["text"] });
    const fetchSpy = vi.fn();
    mockDoh(fetchSpy, serializeApwManifest(manifest));

    const result = await resolveApwManifest("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(true);
    expect(result.manifest).toEqual(manifest);
  });

  it("propaga el motivo de fallo de la capa DNS si no hay TXT records", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ Status: 0, Answer: [] }) });

    const result = await resolveApwManifest("sin-apw.example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("no_txt_records");
  });

  it("reporta el error de validacion si el TXT existe pero no es un manifiesto APW valido", async () => {
    const fetchSpy = vi.fn();
    mockDoh(fetchSpy, "un texto cualquiera que no es json");

    const result = await resolveApwManifest("example.com", fetchSpy as unknown as typeof fetch);

    expect(result.resolved).toBe(false);
    expect(result.reason).toBe("not_an_object");
  });
});
