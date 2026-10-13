// packages/apw-resolver/src/standalone.ts — Phase 4: la superficie
// MINIMA publicable para un cliente verificador externo. Este test
// garantiza (1) que los exports principales existen y funcionan con
// datos reales de los vectores (V-01), y (2) que el grafo de imports
// del standalone NO toca otros paquetes del monorepo ni stores con
// better-sqlite3/D1 -- si alguien meta una importacion prohibida, el
// paquete dejaria de ser standalone y este test lo atrapa.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  jwkThumbprint,
  parseApwDidDocument,
  parseDidKeyId,
  jcs,
  parseApwManifest,
  buildDidDocument,
} from "../../packages/apw-resolver/src/standalone";

describe("standalone: exports del cliente verificador", () => {
  it("jwkThumbprint reproduce el vector V-01 (RFC 8037 A)", async () => {
    const k = await jwkThumbprint({
      kty: "OKP",
      crv: "Ed25519",
      x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      // Miembro privado opcional: se ignora en el thumbprint (V-01).
      d: "nWG1ne9Gmw9S3YxYnJ0jKiBWS2RqZ9BxUxXaR3JqQ0k",
    } as never);
    expect(k).toBe("kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k");
  });

  it("parseDidKeyId parsea y rechaza segun V-02", () => {
    expect(parseDidKeyId("did:apw:example.com#key-12")).toEqual({ did: "did:apw:example.com", sequence: 12 });
    expect(parseDidKeyId("did:apw:example.com#key-0")).toBeNull();
    expect(parseDidKeyId("did:apw:example.com#key-01")).toBeNull();
    expect(parseDidKeyId("did:apw:example.com")).toBeNull();
  });

  it("jcs ordena lexicograficamente (V-04: la forma importa)", () => {
    expect(jcs({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it("parseApwManifest valida el manifest v2 de ejemplo del spec", () => {
    const parsed = parseApwManifest(
      '{"v":2,"siteId":"example.com","trustUrl":"/trust/example.com","contentKinds":["mixed"],"k":"kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k","h":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
    );
    expect(parsed.ok ?? parsed.valid ?? parsed).toBeTruthy();
  });

  it("buildDidDocument + parseApwDidDocument roundtrip", () => {
    const doc = buildDidDocument("did:apw:example.com", {
      kty: "OKP",
      crv: "Ed25519",
      x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    } as never);
    expect(parseApwDidDocument(JSON.parse(JSON.stringify(doc)))?.id).toBe("did:apw:example.com");
  });
});

describe("standalone: grafo de imports sin dependencias del monorepo", () => {
  const root = join(__dirname, "../../packages/apw-resolver/src");

  function collectImports(file: string, seen = new Set<string>()): string[] {
    if (seen.has(file)) return [];
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      return [];
    }
    const files: string[] = [file];
    // Solo imports de valor en tiempo de ejecucion. `import type` /
    // `export type` se borran en el bundle (esbuild) y no cuentan para
    // la superficie runtime del cliente standalone.
    const importRe = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["'](\.[^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(source))) {
      const spec = match[1].replace(/\.js$/, "");
      const target = join(file, "..", spec.endsWith(".ts") ? spec : spec + ".ts");
      files.push(...collectImports(target, seen));
    }
    return files;
  }

  it("el grafo de standalone.ts no importa otros paquetes @portaless ni stores con DB", () => {
    const files = collectImports(join(root, "standalone.ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const rel = file.replace(root, "");
      // Stores con better-sqlite3/D1/Deno: lado servidor, no del cliente.
      expect(rel, rel).not.toMatch(/store-factory|sql-adapter|atproto-links-store|sqlite-driver/);
      // Nada de otros paquetes del monorepo.
      expect(rel, rel).not.toMatch(/\.\.\/\.\.\/(trust-layer|auth|plugin-sandbox|dashboard)/);
    }
  });

  it("los archivos del grafo no importan better-sqlite3 ni @portaless/*", () => {
    const files = collectImports(join(root, "standalone.ts"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']better-sqlite3["']/);
      expect(source, file).not.toMatch(/from\s+["']@portaless\//);
    }
  });
});
