// storage:read / storage:write a traves del Capability Bridge HTTP real
// (functions/api/internal/capability-bridge.js) con un backend SQLite real.
// Verifica el enrutado al backend nuevo (Fase 14, §14.2), el namespace por
// plugin (el pluginName sale del TOKEN, no del body) y el mapeo de los codigos
// de error de cuota a un status HTTP claro.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-bridge-storage-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sharedTokenStore = new InMemoryCapabilityTokenStore();
vi.mock("../../packages/plugin-sandbox/src/registry/stores/capability-token-store-factory", () => ({
  createCapabilityTokenStore: vi.fn(async () => sharedTokenStore),
}));

import { onRequestPost } from "../../functions/api/internal/capability-bridge.js";
import { MAX_STORAGE_VALUE_BYTES } from "../../packages/plugin-sandbox/src/registry/plugin-storage";

let dbSeq = 0;
function makeContext(token: string | null, body: unknown) {
  dbSeq += 1;
  return {
    request: {
      headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}),
      json: async () => body,
    },
    env: { PORTALESS_SQLITE_PATH: join(tmp, `bridge-${dbSeq}.db`) },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("capability-bridge HTTP: storage", () => {
  it("write y luego read ida y vuelta con un token scopeado al plugin", async () => {
    await sharedTokenStore.issue("tok_rw", "mi-plugin", ["storage:read", "storage:write"]);
    const env0 = { PORTALESS_SQLITE_PATH: join(tmp, "shared.db") };
    const write = await onRequestPost({
      request: { headers: new Headers({ Authorization: "Bearer tok_rw" }), json: async () => ({ capability: "storage:write", args: { key: "tema", value: "oscuro" } }) },
      env: env0,
    } as any);
    expect(write.status).toBe(200);

    const read = await onRequestPost({
      request: { headers: new Headers({ Authorization: "Bearer tok_rw" }), json: async () => ({ capability: "storage:read", args: { key: "tema" } }) },
      env: env0,
    } as any);
    expect(read.status).toBe(200);
    expect((await read.json()).result).toMatchObject({ key: "tema", value: "oscuro", found: true });
  });

  it("el namespace sale del TOKEN: otro plugin no ve la clave", async () => {
    const env0 = { PORTALESS_SQLITE_PATH: join(tmp, "iso.db") };
    await sharedTokenStore.issue("tok_a", "plugin-a", ["storage:write", "storage:read"]);
    await sharedTokenStore.issue("tok_b", "plugin-b", ["storage:write", "storage:read"]);

    await onRequestPost({
      request: { headers: new Headers({ Authorization: "Bearer tok_a" }), json: async () => ({ capability: "storage:write", args: { key: "secreto", value: "de-a" } }) },
      env: env0,
    } as any);

    const bRead = await onRequestPost({
      request: { headers: new Headers({ Authorization: "Bearer tok_b" }), json: async () => ({ capability: "storage:read", args: { key: "secreto" } }) },
      env: env0,
    } as any);
    expect((await bRead.json()).result).toMatchObject({ found: false });
  });

  it("clave invalida -> 400 con code STORAGE_INVALID_KEY", async () => {
    await sharedTokenStore.issue("tok_badk", "mi-plugin", ["storage:write"]);
    const res = await onRequestPost(makeContext("tok_badk", { capability: "storage:write", args: { key: "no vale!", value: 1 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("STORAGE_INVALID_KEY");
  });

  it("valor por encima del tope -> 413 con code STORAGE_VALUE_TOO_LARGE", async () => {
    await sharedTokenStore.issue("tok_big", "mi-plugin", ["storage:write"]);
    const res = await onRequestPost(
      makeContext("tok_big", { capability: "storage:write", args: { key: "k", value: "x".repeat(MAX_STORAGE_VALUE_BYTES) } })
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("STORAGE_VALUE_TOO_LARGE");
  });

  it("capacidad fuera del snapshot -> 403 (storage:write con token solo de lectura)", async () => {
    await sharedTokenStore.issue("tok_ro", "mi-plugin", ["storage:read"]);
    const res = await onRequestPost(makeContext("tok_ro", { capability: "storage:write", args: { key: "k", value: 1 } }));
    expect(res.status).toBe(403);
  });

  it("content:read de una pagina inexistente -> 404 con code PAGE_NOT_FOUND (backend real, pagina ausente)", async () => {
    await sharedTokenStore.issue("tok_content", "mi-plugin", ["content:read"]);
    const res = await onRequestPost(
      makeContext("tok_content", { capability: "content:read", args: { slug: "no-existe-jamas" } })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("PAGE_NOT_FOUND");
  });
});
