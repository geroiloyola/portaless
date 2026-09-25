// Tests de functions/api/internal/capability-bridge.js -- la frontera de
// seguridad real del Capability Bridge HTTP. Ver hallazgo de seguridad en
// ROADMAP.md: este endpoint ya NO valida contra un secreto estatico
// compartido (PORTALESS_INTERNAL_BRIDGE_TOKEN) -- valida tokens efimeros
// con TTL y snapshot de capacidades via CapabilityTokenStore.
//
// Mock minimo de env.DB -- solo lo que createCapabilityTokenStore()
// necesita para caer en la rama D1 (env.DB presente). Se prueba con
// InMemoryCapabilityTokenStore inyectado directamente via mock del
// modulo factory, para no depender de una implementacion D1 real ni de
// node:sqlite en este test -- la logica de TTL/snapshot ya esta cubierta
// end-to-end en capability-token-store.test.ts contra
// InMemoryCapabilityTokenStore.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryCapabilityTokenStore } from "../../../../packages/plugin-sandbox/src/registry/stores/capability-token-store";

const sharedTokenStore = new InMemoryCapabilityTokenStore();

vi.mock("../../../../packages/plugin-sandbox/src/registry/stores/capability-token-store-factory", () => ({
  createCapabilityTokenStore: vi.fn(async () => sharedTokenStore),
}));

vi.mock("../../../../packages/atomic-elements/src/persistence/store-factory", () => ({
  createPageStore: vi.fn(async () => ({
    load: vi.fn(async (slug: string) =>
      slug === "existing-page" ? { slug: "existing-page", title: "Pagina existente" } : null
    ),
    save: vi.fn(async () => undefined),
  })),
}));

import { onRequestPost } from "../../../../functions/api/internal/capability-bridge.js";

function makeContext(headers: Record<string, string>, body: unknown) {
  return {
    request: {
      headers: new Headers(headers),
      json: async () => body,
    },
    env: { DB: {} }, // presencia de DB alcanza para que el factory (mockeado) no caiga a memoria real
  } as any;
}

describe("functions/api/internal/capability-bridge.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 si falta el header Authorization por completo", async () => {
    const ctx = makeContext({}, { capability: "content:read", args: { slug: "existing-page" } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it("401 con el ESQUEMA VIEJO -- un Bearer con el nombre del secreto estatico ya removido nunca debe aceptarse", async () => {
    // Este es exactamente el patron que usaba el codigo pre-fix: un
    // secreto fijo compartido. Debe rechazarse de tajo con 401 -- no
    // existe ningun camino de retrocompatibilidad con ese esquema.
    const ctx = makeContext(
      { Authorization: "Bearer PORTALESS_INTERNAL_BRIDGE_TOKEN" },
      { capability: "content:read", args: { slug: "existing-page" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/no existe o ya fue invalidado/i);
  });

  it("401 con un token bien formado (Bearer ...) pero que nunca fue emitido por el store", async () => {
    const ctx = makeContext(
      { Authorization: "Bearer pless_jamas_emitido" },
      { capability: "content:read", args: { slug: "existing-page" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it("401 con un token vencido", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await sharedTokenStore.issue("pless_vencido", "hello-plugin", ["content:read"], 300);
    vi.advanceTimersByTime(300_001);

    const ctx = makeContext(
      { Authorization: "Bearer pless_vencido" },
      { capability: "content:read", args: { slug: "existing-page" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);

    vi.useRealTimers();
  });

  it("200 con un token valido y una capacidad incluida en su snapshot", async () => {
    await sharedTokenStore.issue("pless_valido", "hello-plugin", ["content:read"]);

    const ctx = makeContext(
      { Authorization: "Bearer pless_valido" },
      { capability: "content:read", args: { slug: "existing-page" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.slug).toBe("existing-page");
  });

  it("403 -- ESCALADA DE PRIVILEGIOS: un token emitido solo con content:read no debe poder invocar content:write", async () => {
    // Este es el test central de la frontera de seguridad: el snapshot
    // tomado al emitir el token (content:read UNICAMENTE) se respeta sin
    // importar que capacidad declare pedir el plugin despues. Simula un
    // plugin comprometido o con un bug que intenta escalar mas alla de lo
    // que se le concedio en el momento de arrancar la ejecucion.
    await sharedTokenStore.issue("pless_solo_lectura", "hello-plugin", ["content:read"]);

    const ctx = makeContext(
      { Authorization: "Bearer pless_solo_lectura" },
      { capability: "content:write", args: { slug: "existing-page", title: "Intento de escritura no autorizado" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/no incluida en el token/i);
  });

  it("400 si el body no es JSON valido", async () => {
    await sharedTokenStore.issue("pless_ok", "hello-plugin", ["content:read"]);
    const ctx = makeContext({ Authorization: "Bearer pless_ok" }, null);
    ctx.request.json = async () => {
      throw new Error("invalid json");
    };
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it("400 si capability no esta en el catalogo soportado", async () => {
    await sharedTokenStore.issue("pless_ok2", "hello-plugin", ["content:read"]);
    const ctx = makeContext(
      { Authorization: "Bearer pless_ok2" },
      { capability: "not:a:real:capability", args: {} }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it("501 si la capacidad esta en el snapshot pero no tiene backend real conectado (ej. media:read)", async () => {
    await sharedTokenStore.issue("pless_media", "hello-plugin", ["media:read"]);
    const ctx = makeContext({ Authorization: "Bearer pless_media" }, { capability: "media:read", args: {} });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(501);
  });

  it("un token scopeado a un pluginName no filtra su identidad via el body -- pluginName ya no se acepta en el body", async () => {
    await sharedTokenStore.issue("pless_scope", "hello-plugin", ["content:read"]);

    // Intento de un bootstrap comprometido de mentir su propia identidad
    // via el body -- el endpoint ya no lee pluginName del body en
    // absoluto, asi que este campo extra debe ser inocuo.
    const ctx = makeContext(
      { Authorization: "Bearer pless_scope" },
      { capability: "content:read", pluginName: "commerce-plugin", args: { slug: "existing-page" } }
    );
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });
});
