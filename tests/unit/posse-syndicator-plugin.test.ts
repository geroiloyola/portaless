// tests/unit/posse-syndicator-plugin.test.ts
// Test de integración y contrato para el plugin de sindicación POSSE.
// Verifica que el canon de /posts/ se transforme a mensajes espejo para Bluesky y Mastodon.
import { describe, it, expect } from "vitest";
import {
  loadPosseManifest,
  loadPosseCode,
} from "../../packages/posse-syndicator-plugin/src/host-bridge";
import { validateManifest } from "../../packages/plugin-sandbox/src/manifest/manifest-schema";
import { NodeIsolatedVmAdapter } from "../../packages/plugin-sandbox/src/adapters/node-isolated-vm";

describe("posse-syndicator-plugin", () => {
  it("el manifest.json es valido y solicita content:read y network:fetch", () => {
    const manifest = loadPosseManifest();
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const caps = manifest.requestedCapabilities.map((c) => c.id);
    expect(caps).toContain("content:read");
    expect(caps).toContain("network:fetch");

    const fetchCap = manifest.requestedCapabilities.find((c) => c.id === "network:fetch");
    expect(fetchCap?.allowedHosts).toContain("bsky.social");
    expect(fetchCap?.allowedHosts).toContain("mastodon.social");
  });

  it("el codigo del plugin corre en isolated-vm y formatea posts para Bluesky y Mastodon", async () => {
    const manifest = loadPosseManifest();
    const code = loadPosseCode();
    const adapter = new NodeIsolatedVmAdapter({ installedVersion: "7.0.1", timeoutMs: 3000 });

    const post = {
      title: "Publicación Soberana",
      slug: "publicacion-soberana",
      excerpt: "Un resumen de por qué Markdown en Git sobrevive a las plataformas.",
    };

    // 1. List targets
    const listRes = await adapter.execute({
      manifest,
      granted: new Set(["content:read"]),
      code,
      payload: { action: "listTargets" },
    });
    expect(listRes.success).toBe(true);
    expect(listRes.output).toEqual(["bluesky", "mastodon"]);

    // 2. Format Bluesky
    const bskyRes = await adapter.execute({
      manifest,
      granted: new Set(["content:read"]),
      code,
      payload: {
        action: "formatPayload",
        target: "bluesky",
        post,
        siteUrl: "https://mi-sitio.com",
      },
    });
    expect(bskyRes.success).toBe(true);
    const bskyRecord = bskyRes.output as { text: string; facets: Array<{ features: Array<{ uri: string }> }> };
    expect(bskyRecord.text).toContain("Publicación Soberana");
    expect(bskyRecord.text).toContain("https://mi-sitio.com/blog/publicacion-soberana/");
    expect(bskyRecord.facets[0].features[0].uri).toBe("https://mi-sitio.com/blog/publicacion-soberana/");

    // 3. Format Mastodon
    const mastoRes = await adapter.execute({
      manifest,
      granted: new Set(["content:read"]),
      code,
      payload: {
        action: "formatPayload",
        target: "mastodon",
        post,
        siteUrl: "https://mi-sitio.com",
      },
    });
    expect(mastoRes.success).toBe(true);
    const mastoRecord = mastoRes.output as { status: string; visibility: string };
    expect(mastoRecord.status).toContain("Publicación Soberana");
    expect(mastoRecord.status).toContain("https://mi-sitio.com/blog/publicacion-soberana/");
    expect(mastoRecord.visibility).toBe("public");
  });
});
