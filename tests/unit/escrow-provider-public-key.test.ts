// setPublicKey() y PUT /admin/api/authorized-escrow-providers: cargar,
// reemplazar o quitar la clave publica de un proveedor de escrow SIN rotar su
// API key. Los casos del store corren en memoria y en SQLite real (si abre).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ store: null as any }));
vi.mock("../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, createAuthorizedEscrowProvidersStore: async () => state.store };
});

import {
  InMemoryAuthorizedEscrowProvidersStore,
  SqliteAuthorizedEscrowProvidersStore,
  hashApiKey,
  type AuthorizedEscrowProvidersStore,
} from "../../packages/trust-layer/src/site-trust/authorized-escrow-providers";

const PROVIDER = "escrow-acme";

async function publicJwk(): Promise<JsonWebKey> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return crypto.subtle.exportKey("jwk", kp.publicKey);
}

async function newSqlite(): Promise<AuthorizedEscrowProvidersStore | null> {
  try {
    const mod: any = await import("../../packages/sqlite-driver/src/open");
    return new SqliteAuthorizedEscrowProvidersStore(await mod.openSqlite(":memory:"));
  } catch {
    return null;
  }
}

const sqliteAvailable = (await newSqlite()) !== null;
const backends: Array<{ name: string; make: () => Promise<AuthorizedEscrowProvidersStore> }> = [
  { name: "InMemory", make: async () => new InMemoryAuthorizedEscrowProvidersStore() },
  ...(sqliteAvailable ? [{ name: "SQLite", make: async () => (await newSqlite()) as AuthorizedEscrowProvidersStore }] : []),
];

describe.each(backends)("setPublicKey ($name)", ({ make }) => {
  it("carga la clave sin rotar la API key ni cambiar el estado", async () => {
    const store = await make();
    const { apiKey } = await store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin" });
    const jwk = await publicJwk();

    expect(await store.setPublicKey(PROVIDER, jwk)).toBe(true);
    expect(await store.getPublicKeyJwk(PROVIDER)).toEqual({ kty: "OKP", crv: "Ed25519", x: jwk.x });
    expect(await store.isAuthorized(PROVIDER, await hashApiKey(apiKey))).toBe(true);
    const [listed] = await store.list();
    expect(listed).toMatchObject({ providerId: PROVIDER, active: true, publicKeyJwk: { x: jwk.x } });
  });

  it("reemplaza y quita la clave", async () => {
    const store = await make();
    await store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin", publicKeyJwk: await publicJwk() });
    const second = await publicJwk();

    await store.setPublicKey(PROVIDER, JSON.stringify(second));
    expect((await store.getPublicKeyJwk(PROVIDER))?.x).toBe(second.x);

    await store.setPublicKey(PROVIDER, null);
    expect(await store.getPublicKeyJwk(PROVIDER)).toBeNull();
  });

  it("devuelve false si el proveedor no existe y rechaza claves invalidas o privadas", async () => {
    const store = await make();
    expect(await store.setPublicKey("no-existe", await publicJwk())).toBe(false);

    await store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin" });
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    await expect(store.setPublicKey(PROVIDER, privateJwk)).rejects.toThrow("invalid_public_key_jwk");
    await expect(store.setPublicKey(PROVIDER, { kty: "EC" })).rejects.toThrow("invalid_public_key_jwk");
    expect(await store.getPublicKeyJwk(PROVIDER)).toBeNull();
  });
});

describe("PUT /admin/api/authorized-escrow-providers", () => {
  beforeEach(() => {
    state.store = new InMemoryAuthorizedEscrowProvidersStore();
  });

  async function put(body: unknown, user: unknown = { username: "admin", role: "admin" }) {
    const { onRequestPut } = await import("../../functions/admin/api/authorized-escrow-providers.js");
    const request = new Request("https://ejemplo.com/admin/api/authorized-escrow-providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return onRequestPut({ request, env: {}, data: { user } });
  }

  it("carga la clave de un proveedor existente y no devuelve API key", async () => {
    const { apiKey } = await state.store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin" });
    const jwk = await publicJwk();
    const res = await put({ providerId: PROVIDER, publicKeyJwk: jwk });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await state.store.getPublicKeyJwk(PROVIDER))?.x).toBe(jwk.x);
    expect(await state.store.isAuthorized(PROVIDER, await hashApiKey(apiKey))).toBe(true);
  });

  it("responde 404, 400 y 403 segun corresponda", async () => {
    expect((await put({ providerId: "no-existe", publicKeyJwk: await publicJwk() })).status).toBe(404);

    await state.store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin" });
    const invalid = await put({ providerId: PROVIDER, publicKeyJwk: { kty: "EC" } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("invalid_public_key_jwk");

    expect((await put({ providerId: PROVIDER })).status).toBe(400);
    expect((await put("no es json")).status).toBe(400);
    expect((await put({ providerId: PROVIDER, publicKeyJwk: null }, { username: "v", role: "viewer" })).status).toBe(403);
    expect((await put({ providerId: PROVIDER, publicKeyJwk: null }, null)).status).toBe(401);
  });

  it("publicKeyJwk null quita la clave", async () => {
    await state.store.grant({ providerId: PROVIDER, displayName: "Acme", authorizedBy: "admin", publicKeyJwk: await publicJwk() });
    expect((await put({ providerId: PROVIDER, publicKeyJwk: null })).status).toBe(200);
    expect(await state.store.getPublicKeyJwk(PROVIDER)).toBeNull();
  });
});
