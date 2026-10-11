// POST /admin/api/plugins/run: el caller de produccion del sandbox.
// Prueba las capas servidor-side (sesion, rol, registro, traversal) y el
// camino feliz real: tiny-plugin cargado desde disco y ejecutado en un
// isolate isolated-vm de verdad (mismos guards de skip que el resto de
// los tests con isolated-vm).
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { onRequestPost } from "../../functions/admin/api/plugins/run.js";
import { createPluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/store-factory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PLUGIN_DIR = join(__dirname, "..", "fixtures", "plugins");

const env = { PORTALESS_PLUGIN_DIR: FIXTURE_PLUGIN_DIR };

const adminUser = { role: "admin" };
const viewerUser = { role: "viewer" };

function post(body: unknown, user: unknown) {
  const request = new Request("https://sitio.test/admin/api/plugins/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env, data: user ? { user } : {} } as never);
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
});
