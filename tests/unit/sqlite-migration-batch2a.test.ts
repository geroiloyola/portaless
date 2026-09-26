// v0.0.9.27 -- tanda 2a: allowlists del Trust Layer sobre openSqlite.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthorizedAgentsStore,
  InMemoryAuthorizedAgentsStore,
  SqliteAuthorizedAgentsStore,
} from "../../packages/trust-layer/src/site-trust/authorized-agents";
import {
  createAuthorizedEscrowProvidersStore,
  InMemoryAuthorizedEscrowProvidersStore,
  SqliteAuthorizedEscrowProvidersStore,
  hashApiKey,
} from "../../packages/trust-layer/src/site-trust/authorized-escrow-providers";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-b2a-")), "db.sqlite");

afterEach(() => vi.unstubAllGlobals());

describe("authorized-agents sobre better-sqlite3", () => {
  it("grant/isAuthorized/revoke persisten entre instancias y no cae a memoria", async () => {
    const path = tmpPath();
    const a = await createAuthorizedAgentsStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemoryAuthorizedAgentsStore);
    await a.grant({ agentKeyId: "k1", signatureAgentUrl: "https://agent.example", displayName: "A", authorizedBy: "admin" });

    const b = await createAuthorizedAgentsStore({ PORTALESS_SQLITE_PATH: path });
    expect(await b.isAuthorized("k1")).toBe(true);
    expect((await b.list())[0].keyAlgorithm).toBe("ed25519");
    await b.revoke("k1");
    expect(await a.isAuthorized("k1")).toBe(false);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqliteAuthorizedAgentsStore("/tmp/x.db" as any)).toThrow(/SqliteAuthorizedAgentsStore.open/);
  });

  it("si SQLite no abre, la factory lanza en vez de devolver una allowlist vacia", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    await expect(createAuthorizedAgentsStore({ PORTALESS_SQLITE_PATH: tmpPath() })).rejects.toThrow();
  });
});

describe("authorized-escrow-providers sobre better-sqlite3", () => {
  it("grant devuelve la key una vez; solo el hash autoriza; revoke persiste", async () => {
    const path = tmpPath();
    const a = await createAuthorizedEscrowProvidersStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemoryAuthorizedEscrowProvidersStore);
    const { apiKey } = await a.grant({ providerId: "esc1", displayName: "Escrow", authorizedBy: "admin" });

    const b = await createAuthorizedEscrowProvidersStore({ PORTALESS_SQLITE_PATH: path });
    expect(await b.isAuthorized("esc1", await hashApiKey(apiKey))).toBe(true);
    expect(await b.isAuthorized("esc1", apiKey)).toBe(false);
    expect(JSON.stringify(await b.list())).not.toContain(apiKey);
    await b.revoke("esc1");
    expect(await a.isAuthorized("esc1", await hashApiKey(apiKey))).toBe(false);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqliteAuthorizedEscrowProvidersStore("/tmp/x.db" as any)).toThrow(/SqliteAuthorizedEscrowProvidersStore.open/);
  });

  it("si SQLite no abre, la factory lanza en vez de devolver una allowlist vacia", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    await expect(createAuthorizedEscrowProvidersStore({ PORTALESS_SQLITE_PATH: tmpPath() })).rejects.toThrow();
  });
});
