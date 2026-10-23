import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLUTION_BUDGET_CONFIG_DDL } from "../../packages/persistence-migrations/src/ddl";
import {
  INVALID_RESOLUTION_BUDGET_CONFIG,
  RESOLUTION_BUDGET_CONFIG_CONFLICT,
  SqliteResolutionBudgetConfigStore,
  D1ResolutionBudgetConfigStore,
  validateResolutionBudgetConfiguration,
  type ResolutionBudgetConfiguration,
} from "../../packages/trust-layer/src/net/resolution-budget-config";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function dbPath() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-resolution-config-"));
  dirs.push(dir);
  return join(dir, "portaless.sqlite");
}

const valid: ResolutionBudgetConfiguration = {
  version: 1,
  windowMs: 60_000,
  client: { attempts: 20, bytes: 8 * 1024 * 1024 },
  origin: { attempts: 8, bytes: 4 * 1024 * 1024 },
  maxBuckets: 4096,
  maxConcurrentTotal: 8,
  maxConcurrentPerClient: 4,
  maxConcurrentPerOrigin: 4,
};

describe("typed resolution-budget config and optimistic concurrency", () => {
  it.each([
    ["windowMs", 1000, 3_600_000], ["maxBuckets", 2, 4096],
    ["maxConcurrentTotal", 1, 64], ["maxConcurrentPerClient", 1, 64], ["maxConcurrentPerOrigin", 1, 64],
    ["client.attempts", 1, 100_000], ["origin.attempts", 1, 100_000],
    ["client.bytes", 1, 64 * 1024 * 1024], ["origin.bytes", 1, 64 * 1024 * 1024],
  ])("validates both boundaries server-side for %s", (path, min, max) => {
    const withValue = (value: unknown) => {
      const config: any = JSON.parse(JSON.stringify(valid));
      const keys = String(path).split(".");
      if (keys.length === 2) config[keys[0]][keys[1]] = value;
      else config[keys[0]] = value;
      return config;
    };
    for (const value of [min, max]) expect(validateResolutionBudgetConfiguration(withValue(value))).toBe(true);
    for (const value of [Number(min) - 1, Number(max) + 1, 1.5, String(min), null, NaN, Infinity]) {
      expect(validateResolutionBudgetConfiguration(withValue(value))).toBe(false);
    }
  });
  it("validates exact versioned fields and rejects limits outside bounded ranges", () => {
    expect(validateResolutionBudgetConfiguration(valid)).toBe(true);
    expect(validateResolutionBudgetConfiguration({ ...valid, secret: "must-not-persist" })).toBe(false);
    expect(validateResolutionBudgetConfiguration({ ...valid, client: { ...valid.client, attempts: 0 } })).toBe(false);
    expect(validateResolutionBudgetConfiguration({ ...valid, maxBuckets: 100_000 })).toBe(false);
  });

  it("creates a configuration only at expected null, then updates only the current revision", async () => {
    const path = dbPath();
    const db = new Database(path);
    db.exec(RESOLUTION_BUDGET_CONFIG_DDL);
    db.close();
    const store = await SqliteResolutionBudgetConfigStore.open(path);
    expect(await store.read()).toBeNull();
    const first = await store.compareAndSet(null, valid, "owner");
    expect(first).toMatchObject({ revision: 1, config: valid, updatedBy: "owner" });
    const second = await store.compareAndSet(1, { ...valid, client: { ...valid.client, attempts: 21 } }, "owner-2");
    expect(second.revision).toBe(2);
    await expect(store.compareAndSet(1, valid, "stale-owner")).rejects.toThrow(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    await expect(store.compareAndSet(null, valid, "another-initializer")).rejects.toThrow(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    await expect(store.compareAndSet(2, { ...valid, maxBuckets: -1 }, "owner")).rejects.toThrow(INVALID_RESOLUTION_BUDGET_CONFIG);
    expect((await store.read())?.revision).toBe(2);
    store.close();
  });

  it("allows only one concurrent D1-style update at an expected revision", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(RESOLUTION_BUDGET_CONFIG_DDL);
    const d1 = {
      prepare(sql: string) {
        return {
          first: async () => sqlite.prepare(sql).get(),
          bind(...values: unknown[]) {
            return {
              run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values as any[]).changes } }),
              first: async () => sqlite.prepare(sql).get(...values as any[]),
            };
          },
        };
      },
    };
    const storeA = new D1ResolutionBudgetConfigStore(d1);
    const storeB = new D1ResolutionBudgetConfigStore(d1);
    await storeA.compareAndSet(null, valid, "owner");
    const results = await Promise.allSettled([
      storeA.compareAndSet(1, { ...valid, client: { ...valid.client, attempts: 30 } }, "a"),
      storeB.compareAndSet(1, { ...valid, client: { ...valid.client, attempts: 40 } }, "b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await storeA.read()).toMatchObject({ revision: 2 });
    sqlite.close();
  });
});
