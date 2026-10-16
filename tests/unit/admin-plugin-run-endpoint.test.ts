// POST /admin/api/plugins/run: el caller de produccion del sandbox.
// Prueba las capas servidor-side (sesion, rol, registro, traversal) y el
// camino feliz real: tiny-plugin cargado desde disco y ejecutado en un
// isolate isolated-vm de verdad (mismos guards de skip que el resto de
// los tests con isolated-vm).
import { describe, it, expect, beforeEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { onRequestPost } from "../../functions/admin/api/plugins/run.js";
import { createPluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/store-factory";
import {
  createPluginArtifactStore,
  __resetPluginArtifactStoreForTests,
} from "../../packages/plugin-sandbox/src/registry/plugin-artifacts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PLUGIN_DIR = join(__dirname, "..", "fixtures", "plugins");

const env = { PORTALESS_PLUGIN_DIR: FIXTURE_PLUGIN_DIR };

const adminUser = { role: "admin" };
const viewerUser = { role: "viewer" };

beforeEach(() => {
  __resetPluginArtifactStoreForTests();
});

function post(body: unknown, user: unknown, deps?: Record<string, unknown>) {
  const request = new Request("https://sitio.test/admin/api/plugins/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env, data: user ? { user } : {} } as never, deps as never);
}

async function isolatedVmAvailable(): Promise<boolean> {
  try {
    await import("isolated-vm");
    return true;
  } catch {
    return false;
  }
}

describe("POST /admin/api/plugins/run", () => {
  it("sin sesión responde 401", async () => {
    const res = await post({ plugin: "tiny-plugin" }, null);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("rol viewer responde 403 aunque la sesión sea válida", async () => {
    const res = await post({ plugin: "tiny-plugin" }, viewerUser);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("sin campo plugin responde 400", async () => {
    const res = await post({ payload: {} }, adminUser);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_plugin");
  });

  it("plugin no registrado responde 404", async () => {
    const res = await post({ plugin: "no-existe" }, adminUser);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("plugin_not_registered");
  });

  it("plugin registrado pero inactivo responde 409", async () => {
    const store = await createPluginRegistryStore({});
    await store.register({
      pluginId: "inactivo-demo",
      displayName: "Inactivo (demo)",
      author: "test",
      sourceType: "open",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: false,
    });

    const res = await post({ plugin: "inactivo-demo" }, adminUser);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("plugin_inactive");
  });

  it("id con path traversal responde 400 invalid_plugin_id", async () => {
    const res = await post({ plugin: "../../etc" }, adminUser);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_plugin_id");
  });

  it("plugin registrado pero sin manifest.json en el directorio responde 404 plugin_source_not_found", async () => {
    const store = await createPluginRegistryStore({});
    await store.register({
      pluginId: "sin-codigo",
      displayName: "Sin código (demo)",
      author: "test",
      sourceType: "open",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "sin-codigo" }, adminUser);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("plugin_source_not_found");
  });

  it("camino feliz: tiny-plugin registrado y activo corre en isolated-vm real y devuelve su output", async (t) => {
    if (!(await isolatedVmAvailable())) {
      t.skip("isolated-vm no esta instalado -- test omitido, no fallado.");
      return;
    }

    const store = await createPluginRegistryStore({});
    await store.register({
      pluginId: "tiny-plugin",
      displayName: "Tiny (fixture)",
      author: "test",
      sourceType: "open",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "tiny-plugin", payload: { hola: true } }, adminUser);
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.success).toBe(true);
    expect(result.output).toBe(42);
    expect(result.provider).toBe("node-isolated-vm");
  });

  it("§14.1: ejecuta desde el artefacto guardado sin necesitar filesystem (cierra el 503 de workerd)", async (t) => {
    if (!(await isolatedVmAvailable())) {
      t.skip("isolated-vm no esta instalado -- test omitido, no fallado.");
      return;
    }

    const publisher = "did:apw:pub.example";
    const manifest = {
      name: "stored-only-plugin",
      version: "1.0.0",
      entry: "index.js",
      runtime: "javascript" as const,
      requestedCapabilities: [],
    };
    const code = new TextEncoder().encode("777;");

    const artifacts = await createPluginArtifactStore({});
    await artifacts.put({ publisher, name: manifest.name, version: manifest.version, code, manifest });

    const registry = await createPluginRegistryStore({});
    await registry.register({
      pluginId: manifest.name,
      displayName: "Stored Only",
      author: publisher,
      version: manifest.version,
      sourceType: "closed",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      installedAt: new Date().toISOString(),
      active: true,
    });

    // Con noFs: true (simula workerd, sin node:fs), un plugin con artefacto guardado responde 200 y corre.
    const res = await post({ plugin: "stored-only-plugin", payload: null }, adminUser, { noFs: true });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.success).toBe(true);
    expect(result.output).toBe(777);
  });

  it("§14.1: en workerd (noFs: true), un plugin SIN artefacto guardado sigue respondiendo 503", async () => {
    const store = await createPluginRegistryStore({});
    await store.register({
      pluginId: "solo-disco",
      displayName: "Solo disco",
      author: "Portaless",
      sourceType: "open",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "solo-disco" }, adminUser, { noFs: true });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("plugin_source_backend_unavailable");
  });

  it("§14.1: rechaza con 409 artifact_integrity_failed si el codigo guardado no coincide con su codeHash", async () => {
    const publisher = "did:apw:pub.example";
    const manifest = {
      name: "tampered-plugin",
      version: "1.0.0",
      entry: "index.js",
      runtime: "javascript" as const,
      requestedCapabilities: [],
    };
    const artifacts = await createPluginArtifactStore({});
    await artifacts.put({
      publisher,
      name: manifest.name,
      version: manifest.version,
      code: new TextEncoder().encode("module.exports = () => 1;"),
      codeHash: "0".repeat(64), // hash que no coincide con los bytes guardados
      manifest,
    });

    const registry = await createPluginRegistryStore({});
    await registry.register({
      pluginId: manifest.name,
      displayName: "Tampered",
      author: publisher,
      version: manifest.version,
      sourceType: "closed",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "tampered-plugin" }, adminUser, { noFs: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("artifact_integrity_failed");
  });

  it("§14.1: si la version activa del registro no tiene artefacto -> 409 artifact_version_missing", async () => {
    const publisher = "did:apw:pub.example";
    const artifacts = await createPluginArtifactStore({});
    await artifacts.put({
      publisher,
      name: "mi-plugin",
      version: "1.0.0",
      code: new TextEncoder().encode("1;"),
      manifest: { name: "mi-plugin", version: "1.0.0", entry: "index.js", runtime: "javascript", requestedCapabilities: [] },
    });
    const registry = await createPluginRegistryStore({});
    await registry.register({
      pluginId: "mi-plugin",
      displayName: "Mi plugin",
      author: publisher,
      version: "2.0.0", // version activa SIN artefacto guardado
      sourceType: "closed",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "mi-plugin" }, adminUser, { noFs: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("artifact_version_missing");
  });

  it("§14.1: rechaza con 409 artifact_manifest_missing si el artefacto guardado no trae manifiesto", async () => {
    const publisher = "did:apw:pub.example";
    const artifacts = await createPluginArtifactStore({});
    await artifacts.put({
      publisher,
      name: "legacy-no-manifest",
      version: "1.0.0",
      code: new TextEncoder().encode("module.exports = () => 1;"),
    });

    const registry = await createPluginRegistryStore({});
    await registry.register({
      pluginId: "legacy-no-manifest",
      displayName: "Legacy",
      author: publisher,
      version: "1.0.0",
      sourceType: "closed",
      requestedCapabilities: [],
      registeredAt: new Date().toISOString(),
      active: true,
    });

    const res = await post({ plugin: "legacy-no-manifest" }, adminUser, { noFs: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("artifact_manifest_missing");
  });
});
