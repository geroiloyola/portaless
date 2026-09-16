// Test de la integracion real (v0.0.9.1) del DenoDeployAdapter contra la
// API REST publica de Deno Deploy. Como no hay credenciales reales de
// prueba disponibles (ver ROADMAP.md), este test NO llama a la API real
// -- inyecta un `fetch` mockeado via `fetchImpl` en la config del
// adaptador y verifica:
//   1. Que el request de creacion de deployment tenga la forma correcta
//      (URL, headers, body) segun la documentacion oficial.
//   2. Que el mapeo de capacidades (network:fetch -> allowedHosts,
//      capacidades no-red -> bridge HTTP) se refleje en el bootstrap
//      subido.
//   3. Que la respuesta de la API se traduzca correctamente a
//      SandboxExecutionResult, tanto en el camino feliz como en errores
//      HTTP y de red.
//
// IMPORTANTE: pasar estos tests NO garantiza que la integracion funcione
// contra la API real de Deno Deploy -- solo confirma que la logica
// interna de este adaptador es correcta dado el formato de API
// documentado publicamente. El primer uso real contra una cuenta de
// prueba debe tratarse como una verificacion pendiente.

import { describe, it, expect, vi } from "vitest";
import { DenoDeployAdapter } from "../../packages/plugin-sandbox/src/adapters/deno-deploy";
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

describe("DenoDeployAdapter -- integracion real v0.0.9.1 (fetch mockeado)", () => {
  it("crea la deployment con el body documentado y luego invoca la URL devuelta", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse({ id: "abc123", domains: ["abc123.deno.dev"] });
      }
      return jsonResponse({ __portalessOutput: { greeting: "hola" } });
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest(),
      granted: new Set() as GrantedCapabilities,
      code: "globalThis.__portalessPluginEntry = async (payload) => ({ greeting: 'hola' });",
      payload: { name: "mundo" },
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ greeting: "hola" });
    expect(result.provider).toBe("deno-deploy");

    expect(calls).toHaveLength(2);
    // Paso 1: creacion de deployment.
    expect(calls[0].url).toBe("https://api.deno.com/v1/projects/proj-1/deployments");
    expect(calls[0].init?.method).toBe("POST");
    const headers1 = calls[0].init?.headers as Record<string, string>;
    expect(headers1.authorization).toBe("Bearer tok-1");
    const body1 = JSON.parse(calls[0].init?.body as string);
    expect(body1.entryPointUrl).toBe("main.ts");
    expect(body1.assets["main.ts"].kind).toBe("file");
    expect(body1.assets["main.ts"].content).toContain("__portalessPluginEntry");

    // Paso 3: invocacion de la deployment recien creada.
    expect(calls[1].url).toBe("https://abc123.deno.dev");
    const body2 = JSON.parse(calls[1].init?.body as string);
    expect(body2).toEqual({ name: "mundo" });
  });

  it("cae al patron {id}.deno.dev si la respuesta no incluye 'domains'", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/deployments")) {
        return jsonResponse({ id: "xyz789" });
      }
      expect(String(url)).toBe("https://xyz789.deno.dev");
      return jsonResponse({ __portalessOutput: 42 });
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest(),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe(42);
  });

  it("mapea network:fetch concedido con allowedHosts al bootstrap subido", async () => {
    let uploadedBody: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/deployments")) {
        const body = JSON.parse(init?.body as string);
        uploadedBody = body.assets["main.ts"].content;
        return jsonResponse({ id: "abc", domains: ["abc.deno.dev"] });
      }
      return jsonResponse({ __portalessOutput: null });
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await adapter.execute({
      manifest: makeManifest({
        requestedCapabilities: [
          { id: "network:fetch", reason: "test", allowedHosts: ["api.ejemplo.com"] },
        ],
      }),
      granted: new Set(["network:fetch"]) as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(uploadedBody).toContain('"api.ejemplo.com"');
  });

  it("capacidad no-red concedida sin bridgeUrl configurado -- el bootstrap documenta el fallo pero la creacion de deployment sigue OK", async () => {
    let uploadedBody: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/deployments")) {
        const body = JSON.parse(init?.body as string);
        uploadedBody = body.assets["main.ts"].content;
        return jsonResponse({ id: "abc", domains: ["abc.deno.dev"] });
      }
      return jsonResponse({ __portalessOutput: null });
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await adapter.execute({
      manifest: makeManifest({
        requestedCapabilities: [{ id: "storage:read", reason: "test" }],
      }),
      granted: new Set(["storage:read"]) as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(uploadedBody).toContain('"storage:read"');
    expect(uploadedBody).toContain("no hay bridge HTTP configurado");
  });

  it("capacidad no-red solicitada pero NO concedida se reporta en deniedCapabilityAttempts", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/deployments")) {
        return jsonResponse({ id: "abc", domains: ["abc.deno.dev"] });
      }
      return jsonResponse({ __portalessOutput: null });
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await adapter.execute({
      manifest: makeManifest({
        requestedCapabilities: [{ id: "email:send", reason: "test" }],
      }),
      granted: new Set() as GrantedCapabilities,
      code: "",
      payload: null,
    });

    expect(result.deniedCapabilityAttempts).toEqual(["email:send"]);
  });

  it("propaga un error HTTP no-2xx al crear la deployment como fallo explicito", async () => {
    const fetchImpl = vi.fn(async () => new Response("token invalido", { status: 401 }));

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
      apiToken: "tok-invalido",
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
    expect(result.error).toContain("token invalido");
  });

  it("propaga un error de red (fetch rechazado) como fallo explicito, no como excepcion sin capturar", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
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
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("propaga __portalessError de la respuesta de invocacion como fallo explicito", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/deployments")) {
        return jsonResponse({ id: "abc", domains: ["abc.deno.dev"] });
      }
      return jsonResponse({ __portalessError: "el plugin lanzo un error interno" }, 500);
    });

    const adapter = new DenoDeployAdapter({
      projectId: "proj-1",
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
    expect(result.error).toBe("el plugin lanzo un error interno");
  });

  it("isAvailable() solo valida presencia de config, no hace llamada de red", async () => {
    const fetchImpl = vi.fn();
    const adapter = new DenoDeployAdapter({ projectId: "p", apiToken: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await adapter.isAvailable()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    const incomplete = new DenoDeployAdapter({ projectId: "", apiToken: "t" });
    expect(await incomplete.isAvailable()).toBe(false);
  });
});
