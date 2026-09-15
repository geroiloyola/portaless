// Test de la integracion real (v0.0.9.1) del
// CloudflareWorkersForPlatformsAdapter contra la API REST publica de
// Cloudflare. Como no hay credenciales reales de prueba disponibles (ver
// ROADMAP.md), este test NO llama a la API real -- inyecta un `fetch`
// mockeado via `fetchImpl` en la config del adaptador y verifica:
//   1. Que el request de subida de script (PUT, multipart/form-data)
//      tenga la forma correcta segun la documentacion oficial.
//   2. Que la invocacion via el dispatcher fijo pase el scriptName
//      deterministico correcto.
//   3. Que la respuesta se traduzca correctamente a
//      SandboxExecutionResult, en el camino feliz y en errores.
//
// IMPORTANTE: pasar estos tests NO garantiza que la integracion funcione
// contra la API real de Cloudflare ni contra un dispatcher real -- solo
// confirma que la logica interna de este adaptador es correcta dado el
// formato de API documentado publicamente. El primer uso real requiere
// ademas tener un Worker dispatcher desplegado (ver nota de
// infraestructura en cloudflare-workers-for-platforms.ts).

import { describe, it, expect, vi } from "vitest";
import { CloudflareWorkersForPlatformsAdapter } from "../../packages/plugin-sandbox/src/adapters/cloudflare-workers-for-platforms";
import type { PluginManifest, GrantedCapabilities } from "../../packages/plugin-sandbox/src/types";

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: "test-plugin",
    version: "0.0.1",
    entry: "index.js",
    runtime: "javascript",
    requestedCapabilities: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("CloudflareWorkersForPlatformsAdapter -- integracion real v0.0.9.1 (fetch mockeado)", () => {
  it("sube el script via PUT multipart y luego invoca via el dispatcher con el scriptName correcto", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({ __portalessOutput: { greeting: "hola" } });
    });

    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-1",
      dispatcherUrl: "https://dispatcher.example.workers.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest({ name: "Mi Plugin", version: "1.0.0" }),
      granted: new Set() as GrantedCapabilities,
      code: "globalThis.__portalessPluginEntry = async () => ({ greeting: 'hola' });",
      payload: { x: 1 },
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ greeting: "hola" });
    expect(result.provider).toBe("cloudflare-workers-for-platforms");

    expect(calls).toHaveLength(2);
    // Paso 1: subida del script.
    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/workers/dispatch/namespaces/ns-1/scripts/mi-plugin-1-0-0",
    );
    expect(calls[0].init?.method).toBe("PUT");
    const headers1 = calls[0].init?.headers as Record<string, string>;
    expect(headers1.authorization).toBe("Bearer tok-1");
    expect(calls[0].init?.body).toBeInstanceOf(FormData);

    // Paso 3: invocacion via el dispatcher.
    expect(calls[1].url).toBe("https://dispatcher.example.workers.dev");
    const headers2 = calls[1].init?.headers as Record<string, string>;
    expect(headers2["x-portaless-script-name"]).toBe("mi-plugin-1-0-0");
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ x: 1 });
  });

  it("falla explicitamente si dispatcherUrl no esta configurado, sin intentar el fetch de invocacion", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest(),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("dispatcherUrl no configurado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propaga un rechazo de Cloudflare (success:false en el body) como fallo explicito con los mensajes de error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, errors: [{ message: "script invalido" }] }));

    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-1",
      dispatcherUrl: "https://dispatcher.example.workers.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest(),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("script invalido");
  });

  it("propaga un error HTTP no-2xx al subir el script como fallo explicito", async () => {
    const fetchImpl = vi.fn(async () => new Response("token invalido", { status: 401 }));

    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-invalido",
      dispatcherUrl: "https://dispatcher.example.workers.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest(),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("capacidad no-red solicitada pero NO concedida se reporta en deniedCapabilityAttempts", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/scripts/")) return jsonResponse({ success: true });
      return jsonResponse({ __portalessOutput: null });
    });

    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-1",
      dispatcherUrl: "https://dispatcher.example.workers.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest({ requestedCapabilities: [{ id: "site:admin", reason: "test" }] }),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.deniedCapabilityAttempts).toEqual(["site:admin"]);
  });

  it("scriptName es deterministico: mismo name+version produce el mismo scriptName en llamadas repetidas", async () => {
    const uploadUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/scripts/")) {
        uploadUrls.push(urlStr);
        return jsonResponse({ success: true });
      }
      return jsonResponse({ __portalessOutput: null });
    });

    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "acc-1",
      dispatchNamespace: "ns-1",
      apiToken: "tok-1",
      dispatcherUrl: "https://dispatcher.example.workers.dev",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const manifest = makeManifest({ name: "same-plugin", version: "2.0.0" });
    await adapter.execute({ manifest, granted: new Set() as GrantedCapabilities, code: "", payload: null });
    await adapter.execute({ manifest, granted: new Set() as GrantedCapabilities, code: "", payload: null });

    expect(uploadUrls).toHaveLength(2);
    expect(uploadUrls[0]).toBe(uploadUrls[1]);
  });

  it("isAvailable() solo valida presencia de config, no hace llamada de red", async () => {
    const fetchImpl = vi.fn();
    const adapter = new CloudflareWorkersForPlatformsAdapter({
      accountId: "a",
      dispatchNamespace: "n",
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await adapter.isAvailable()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    const incomplete = new CloudflareWorkersForPlatformsAdapter({ accountId: "", dispatchNamespace: "n", apiToken: "t" });
    expect(await incomplete.isAvailable()).toBe(false);
  });
});
