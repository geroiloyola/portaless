import { describe, it, expect } from "vitest";
import { onRequestGet } from "../../functions/.well-known/portaless-usage-log.json.js";

// Mock minimo de D1Database en memoria -- implementa solo lo que
// D1UsageLedgerStore usa (prepare().bind().all()/run()). Mismo patron que
// tests/unit/admin-permissions-role-check.test.ts. Usa env.DB (ver
// packages/trust-layer/src/ledger/store-factory.ts).
function makeFakeD1() {
  const rows = new Map<
    string,
    {
      period: string;
      operator_key_id: string;
      operator_name_claimed: string | null;
      requests_total: number;
      requests_charged: number;
      requests_free_tier: number;
      revenue_usd: number;
      policy_violations_detected: number;
      first_seen: string;
      last_seen: string;
    }
  >();

  function key(period: string, operatorKeyId: string) {
    return `${period}:${operatorKeyId}`;
  }

  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return api;
        },
        async first() {
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO usage_ledger")) {
            const [
              period,
              operatorKeyId,
              operatorNameClaimed,
              requestsTotal,
              requestsCharged,
              requestsFreeTier,
              revenueUsd,
              policyViolationsDetected,
              firstSeen,
              lastSeen,
            ] = boundArgs as [string, string, string | null, number, number, number, number, number, string, string];
            rows.set(key(period, operatorKeyId), {
              period,
              operator_key_id: operatorKeyId,
              operator_name_claimed: operatorNameClaimed,
              requests_total: requestsTotal,
              requests_charged: requestsCharged,
              requests_free_tier: requestsFreeTier,
              revenue_usd: revenueUsd,
              policy_violations_detected: policyViolationsDetected,
              first_seen: firstSeen,
              last_seen: lastSeen,
            });
          }
          return { success: true };
        },
        async all() {
          if (sql.includes("WHERE period")) {
            const [period] = boundArgs as [string];
            return { results: [...rows.values()].filter((r) => r.period === period) };
          }
          return { results: [...rows.values()] };
        },
      };
      return api;
    },
  };
}

function makeContext(url: string, env: Record<string, unknown>) {
  return { request: { url }, env } as any;
}

describe("functions/.well-known/portaless-usage-log.json.js", () => {
  it("responde 200 con agents:[] para un periodo sin datos (no 404)", async () => {
    const ctx = makeContext("https://example.com/.well-known/portaless-usage-log.json?period=2025-01", {
      DB: makeFakeD1(),
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe("2025-01");
    expect(body.agents).toEqual([]);
  });

  it("usa el mes UTC actual cuando no se pasa ?period", async () => {
    const now = new Date();
    const expectedPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const ctx = makeContext("https://example.com/.well-known/portaless-usage-log.json", { DB: makeFakeD1() });
    const res = await onRequestGet(ctx);
    const body = await res.json();
    expect(body.period).toBe(expectedPeriod);
  });

  it("rechaza con 400 un ?period con formato invalido", async () => {
    const ctx = makeContext("https://example.com/.well-known/portaless-usage-log.json?period=not-a-period", {
      DB: makeFakeD1(),
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it("devuelve las entradas reales escritas previamente via recordAgentAccess (integracion con log-writer)", async () => {
    const fakeDb = makeFakeD1();
    const env = { DB: fakeDb };

    const { createUsageLedgerStore } = await import("../../packages/trust-layer/src/ledger/store-factory.ts");
    const { recordAgentAccess } = await import("../../packages/trust-layer/src/ledger/log-writer.ts");
    const store = await createUsageLedgerStore(env);

    await recordAgentAccess(store, { operatorKeyId: "operator-abc", charged: true, amountUsd: 0.02 });
    await recordAgentAccess(store, { operatorKeyId: "operator-abc", charged: true, amountUsd: 0.02 });
    await recordAgentAccess(store, { operatorKeyId: "operator-xyz", charged: false, amountUsd: 0, policyViolation: true });

    const ctx = makeContext("https://example.com/.well-known/portaless-usage-log.json", env);
    const res = await onRequestGet(ctx);
    const body = await res.json();

    const abc = body.agents.find((a: any) => a.operatorKeyId === "operator-abc");
    expect(abc.requestsTotal).toBe(2);
    expect(abc.requestsCharged).toBe(2);
    expect(abc.revenueUsd).toBeCloseTo(0.04);

    const xyz = body.agents.find((a: any) => a.operatorKeyId === "operator-xyz");
    expect(xyz.requestsFreeTier).toBe(1);
    expect(xyz.policyViolationsDetected).toBe(1);
  });

  it("cae a memoria (sin persistencia real) si no hay DB ni PORTALESS_SQLITE_PATH, y sigue respondiendo 200", async () => {
    const ctx = makeContext("https://example.com/.well-known/portaless-usage-log.json?period=2025-06", {});
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });
});
