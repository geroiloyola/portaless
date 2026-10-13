// packages/trust-layer/src/site-trust/stores/d1-site-trust-store.ts:
// 41 lineas a 0%. El backend SQLite del mismo contrato ya estaba cubierto
// (vote-endpoints.test.ts lo ejercita via el endpoint community); este
// test cubre el backend D1 (Cloudflare) con un fake de D1Database sobre
// better-sqlite3, mismo patron que users-store-totp-oauth.test.ts, y el
// schema completo via applySchema(schema.sql).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../scripts/setup.mjs";
import { D1SiteTrustScoreStore } from "../../packages/trust-layer/src/site-trust/stores/d1-site-trust-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-d1-trust-"));
const dbPath = join(tmp, "trust.db");
let store: D1SiteTrustScoreStore;
let db: any;

function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

beforeAll(async () => {
  await applySchema(dbPath, { quiet: true });
  db = new Database(dbPath);
  store = new D1SiteTrustScoreStore(fakeD1(db));
});

afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("D1SiteTrustScoreStore", () => {
  it("getSnapshot de un sitio nuevo devuelve listas vacias", async () => {
    const snap = await store.getSnapshot("sitio-nuevo");
    expect(snap.siteId).toBe("sitio-nuevo");
    expect(snap.self).toEqual([]);
    expect(snap.agent).toEqual([]);
    expect(snap.community).toEqual([]);
    expect(snap.escrowReports).toEqual([]);
  });

  it("recordSelfEvaluation persiste y se lee en el snapshot (upsert por categoria)", async () => {
    await store.recordSelfEvaluation({
      siteId: "s1",
      category: "privacy_policy",
      declaredValue: true,
      declaredBy: "admin",
      declaredAt: "2026-10-01T00:00:00.000Z",
    });
    await store.recordSelfEvaluation({
      siteId: "s1",
      category: "privacy_policy",
      declaredValue: false,
      declaredBy: "admin",
      declaredAt: "2026-10-02T00:00:00.000Z",
      evidenceUrl: "https://x.example/p",
    });
    const snap = await store.getSnapshot("s1");
    expect(snap.self).toHaveLength(1);
    expect(snap.self[0]).toMatchObject({
      category: "privacy_policy",
      declaredValue: false,
      evidenceUrl: "https://x.example/p",
      declaredBy: "admin",
    });
  });

  it("recordCommunityVote + isRateLimited: misma IP/cat dentro de la ventana, no fuera", async () => {
    await store.recordCommunityVote({
      siteId: "s2",
      category: "content_accuracy",
      score: 4,
      voterId: "v1",
      ipHash: "hash-ip-1",
      // Relativo al reloj: una fecha dura ("hoy") salia de la ventana de
      // 48h con el paso de los dias y el test pasaba a fallar solo.
      votedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    // Ventana amplia: la votacion de hoy cuenta.
    expect(await store.isRateLimited("s2", "content_accuracy", "hash-ip-1", 48 * 60 * 60 * 1000)).toBe(true);
    // Otra IP y otra categoria no estan limitadas.
    expect(await store.isRateLimited("s2", "content_accuracy", "hash-ip-2", 48 * 60 * 60 * 1000)).toBe(false);
    expect(await store.isRateLimited("s2", "spam_or_deceptive", "hash-ip-1", 48 * 60 * 60 * 1000)).toBe(false);
    // El voto queda en el snapshot sin exponer mas campos de los permitidos.
    const snap = await store.getSnapshot("s2");
    expect(snap.community).toHaveLength(1);
    expect(snap.community[0]).toMatchObject({ score: 4, voterId: "v1", ipHash: "hash-ip-1" });
  });

  it("isRateLimited respeta el limite de 24h del endpoint (voto viejo ya no limita)", async () => {
    await store.recordCommunityVote({
      siteId: "s3",
      category: "responsiveness",
      score: 5,
      voterId: "viejito",
      ipHash: "hash-vieja",
      votedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    expect(await store.isRateLimited("s3", "responsiveness", "hash-vieja", 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("recordAgentVerification persiste la verificacion (positiva y negativa)", async () => {
    await store.recordAgentVerification({
      siteId: "s4",
      category: "https_and_headers",
      verified: true,
      agentKeyId: "agent-1",
      verifiedAt: "2026-10-10T00:00:00.000Z",
      detail: { hsts: true },
    });
    await store.recordAgentVerification({
      siteId: "s4",
      category: "structured_data_quality",
      verified: false,
      agentKeyId: "agent-1",
      verifiedAt: "2026-10-10T00:00:00.000Z",
    });
    const snap = await store.getSnapshot("s4");
    expect(snap.agent).toHaveLength(2);
    expect(snap.agent.find((a) => a.category === "https_and_headers")?.verified).toBe(true);
    expect(snap.agent.find((a) => a.category === "structured_data_quality")?.verified).toBe(false);
  });
});
