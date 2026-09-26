// v0.0.9.27 -- tanda 2b: plugin registry, ledger, site-trust y scripts CLI sobre better-sqlite3.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/store-factory";
import { InMemoryPluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/plugin-registry";
import { SqlitePluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/stores/sqlite-plugin-registry-store";
import { createUsageLedgerStore } from "../../packages/trust-layer/src/ledger/store-factory";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { SqliteUsageLedgerStore } from "../../packages/trust-layer/src/ledger/sqlite-log-store";
import { createSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/store-factory";
import { InMemorySiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/site-trust-score";
import { SqliteSiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/stores/sqlite-site-trust-store";
import { createAuthorizedAgentsStore } from "../../packages/trust-layer/src/site-trust/authorized-agents";
import { createAuthorizedEscrowProvidersStore, hashApiKey } from "../../packages/trust-layer/src/site-trust/authorized-escrow-providers";
import { runOnboardAgent } from "../../scripts/onboard-agent.mjs";
import { runOnboardEscrowProvider } from "../../scripts/onboard-escrow-provider.mjs";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-b2b-")), "db.sqlite");
const workerd = () => vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("plugin registry sobre better-sqlite3", () => {
  it("no cae a memoria, seedea una sola vez y persiste register/setActive/recordVote", async () => {
    const path = tmpPath();
    const a = await createPluginRegistryStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemoryPluginRegistryStore);
    expect((await a.list(false)).map((p) => p.pluginId).sort()).toEqual(["commerce-plugin", "hello-plugin"]);

    const now = new Date().toISOString();
    await a.register({
      pluginId: "p-extra", displayName: "Extra", author: "x", sourceType: "open",
      requestedCapabilities: ["network:fetch"] as any, registeredAt: now, active: true,
    } as any);
    await a.setActive("hello-plugin", false);
    await a.recordVote({ pluginId: "p-extra", voterId: "v1", score: 4, votedAt: now } as any);
    await a.recordVote({ pluginId: "p-extra", voterId: "v2", score: 2, votedAt: now } as any);

    const b = await createPluginRegistryStore({ PORTALESS_SQLITE_PATH: path });
    expect(await b.list(false)).toHaveLength(3);
    expect((await b.list(true)).map((p) => p.pluginId)).not.toContain("hello-plugin");
    const extra = await b.get("p-extra");
    expect(extra?.trustScore).toBe(3);
    expect(extra?.trustScoreVotes).toBe(2);
    expect(extra?.requestedCapabilities).toEqual(["network:fetch"]);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqlitePluginRegistryStore("/tmp/x.db" as any)).toThrow(/SqlitePluginRegistryStore.open/);
  });

  it("si SQLite no abre, la factory lanza en vez de devolver el catalogo demo en memoria", async () => {
    workerd();
    await expect(createPluginRegistryStore({ PORTALESS_SQLITE_PATH: tmpPath() })).rejects.toThrow();
  });
});

describe("usage ledger sobre better-sqlite3", () => {
  it("put/get persisten entre instancias y no cae a memoria", async () => {
    const path = tmpPath();
    const a = await createUsageLedgerStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemoryUsageLedgerStore);
    const now = new Date().toISOString();
    await a.put("2026-09", {
      period: "2026-09", generatedAt: now,
      agents: [{
        operatorKeyId: "op1", requestsTotal: 10, requestsCharged: 7, requestsFreeTier: 3,
        revenueUsd: 1.5, policyViolationsDetected: 0, firstSeen: now, lastSeen: now,
      }],
    } as any);

    const b = await createUsageLedgerStore({ PORTALESS_SQLITE_PATH: path });
    const period = await b.get("2026-09");
    expect(period?.agents).toHaveLength(1);
    expect(period?.agents[0]).toMatchObject({ operatorKeyId: "op1", requestsCharged: 7, revenueUsd: 1.5 });
    expect(await b.get("2026-10")).toBeNull();
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqliteUsageLedgerStore("/tmp/x.db" as any)).toThrow(/SqliteUsageLedgerStore.open/);
  });

  it("si SQLite no abre, la factory lanza en vez de perder el ledger en memoria", async () => {
    workerd();
    await expect(createUsageLedgerStore({ PORTALESS_SQLITE_PATH: tmpPath() })).rejects.toThrow();
  });
});

describe("site-trust sobre better-sqlite3", () => {
  it("snapshot y rate limit persisten entre instancias y no cae a memoria", async () => {
    const path = tmpPath();
    const a = await createSiteTrustScoreStore({ PORTALESS_SQLITE_PATH: path });
    expect(a).not.toBeInstanceOf(InMemorySiteTrustScoreStore);
    const now = new Date().toISOString();
    await a.recordSelfEvaluation({ siteId: "s1", category: "https" as any, declaredValue: true, declaredBy: "admin", declaredAt: now } as any);
    await a.recordCommunityVote({ siteId: "s1", category: "quality" as any, score: 5, voterId: "v1", ipHash: "h1", votedAt: now } as any);

    const b = await createSiteTrustScoreStore({ PORTALESS_SQLITE_PATH: path });
    const snap = await b.getSnapshot("s1");
    expect(snap.self).toHaveLength(1);
    expect(snap.self[0].declaredValue).toBe(true);
    expect(snap.community[0]).toMatchObject({ voterId: "v1", score: 5, ipHash: "h1" });
    expect(await b.isRateLimited("s1", "quality" as any, "h1")).toBe(true);
    expect(await b.isRateLimited("s1", "quality" as any, "otro")).toBe(false);
  });

  it("el constructor rechaza una ruta string", () => {
    expect(() => new SqliteSiteTrustScoreStore("/tmp/x.db" as any)).toThrow(/SqliteSiteTrustScoreStore.open/);
  });

  it("si SQLite no abre, la factory lanza en vez de servir un score vacio", async () => {
    workerd();
    await expect(createSiteTrustScoreStore({ PORTALESS_SQLITE_PATH: tmpPath() })).rejects.toThrow();
  });
});

describe("scripts CLI sobre better-sqlite3", () => {
  it("onboard-agent escribe una fila que SqliteAuthorizedAgentsStore reconoce", async () => {
    const path = tmpPath();
    vi.stubEnv("PORTALESS_SQLITE_PATH", path);
    vi.spyOn(console, "log").mockImplementation(() => {});
    runOnboardAgent(["node", "onboard-agent.mjs", "--agent-key-id=k-cli", "--signature-agent-url=https://a.example", "--display-name=CLI", "--authorized-by=admin"]);

    const store = await createAuthorizedAgentsStore({ PORTALESS_SQLITE_PATH: path });
    expect(await store.isAuthorized("k-cli")).toBe(true);
    expect((await store.list())[0].keyAlgorithm).toBe("ed25519");
  });

  it("onboard-escrow-provider imprime la key una vez y persiste solo su hash", async () => {
    const path = tmpPath();
    vi.stubEnv("PORTALESS_SQLITE_PATH", path);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    await runOnboardEscrowProvider(["node", "onboard-escrow-provider.mjs", "--provider-id=esc-cli", "--display-name=CLI", "--authorized-by=admin"]);

    const apiKey = logs.map((l) => l.trim()).find((l) => /^pless_escrow_/.test(l));
    expect(apiKey).toBeDefined();
    const store = await createAuthorizedEscrowProvidersStore({ PORTALESS_SQLITE_PATH: path });
    expect(await store.isAuthorized("esc-cli", await hashApiKey(apiKey!))).toBe(true);
    expect(await store.isAuthorized("esc-cli", apiKey!)).toBe(false);
  });
});
