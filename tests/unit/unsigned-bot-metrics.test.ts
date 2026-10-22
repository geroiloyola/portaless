import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordUnsignedBotRejection, readUnsignedBotRejections, unsignedBotFamily, __flushUnsignedBotMetricsForTests, BOT_METRICS_FLUSH_MS } from "../../packages/trust-layer/src/ledger/unsigned-bot-metrics";
import { onRequestGet } from "../../functions/admin/api/agents.js";

describe("R4 unsigned-bot telemetry, not identity/reputation", () => {
  it.each([["Googlebot/2.1", "googlebot"], ["bingbot/2.0", "bingbot"], ["GPTBot/1.0", "other"], [null, "unknown"]])("buckets %s without storing the raw UA", (ua, family) => {
    expect(unsignedBotFamily(ua)).toBe(family);
  });
  it("persists atomic monthly counters in SQLite, exposes them only to an authenticated panel, and prunes older periods", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portaless-metrics-"));
    const path = join(dir, "metrics.sqlite");
    const env = { PORTALESS_SQLITE_PATH: path };
    try {
      const now = new Date("2026-10-22T12:00:00Z");
      await recordUnsignedBotRejection(env, "Googlebot private-UA-secret", new Date("2024-01-01"));
      await Promise.all(Array.from({ length: 25 }, () => recordUnsignedBotRejection(env, "Googlebot private-UA-secret", now)));
      await recordUnsignedBotRejection(env, "bingbot", now);
      await __flushUnsignedBotMetricsForTests(env);
      const result = await readUnsignedBotRejections(env, now);
      expect(result.periods).toEqual([{ period: "2026-10", googlebot: 25, bingbot: 1, other: 0, unknown: 0 }]);
      const db = new Database(path);
      const rows = db.prepare("SELECT * FROM site_settings").all();
      db.close();
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain("private-UA-secret");
      const context = { request: new Request("https://site.example/admin/api/agents"), env, data: {} };
      expect((await onRequestGet(context)).status).toBe(401);
      const response = await onRequestGet({ ...context, data: { user: { username: "owner", role: "admin" } } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).unsignedBotRejections.available).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("uses the same atomic SQL contract in D1 (real SQLite adapter)", async () => {
    const sqlite = new Database(":memory:");
    const DB = { prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      const bound = (args: unknown[] = []) => ({
        statement, args,
        run: async () => statement.run(...args),
        all: async () => ({ results: statement.all(...args) }),
      });
      return { ...bound(), bind: (...args: unknown[]) => bound(args) };
    }, async batch(statements: any[]) {
      return sqlite.transaction(() => statements.map((item) => item.statement.run(...item.args)))();
    } };
    try {
      const now = new Date("2026-10-22");
      await Promise.all(Array.from({ length: 30 }, () => recordUnsignedBotRejection({ DB }, "bingbot", now)));
      await __flushUnsignedBotMetricsForTests({ DB });
      expect((await readUnsignedBotRejections({ DB }, now)).periods[0].bingbot).toBe(30);
    } finally { sqlite.close(); }
  });

  it("post97: N unauthenticated rejections start zero DB writes and one UPSERT per family at the interval", async () => {
    vi.useFakeTimers();
    const sqlite = new Database(":memory:");
    let upserts = 0;
    let prunes = 0;
    let ddl = 0;
    const DB = {
      prepare(sql: string) {
        const bound = (args: unknown[] = []) => ({
          sql, args,
          run: async () => { ddl++; return sqlite.prepare(sql).run(...args); },
          all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        });
        return { ...bound(), bind: (...args: unknown[]) => bound(args) };
      },
      async batch(statements: any[]) {
        return sqlite.transaction(() => statements.map(({ sql, args }) => {
          if (sql.startsWith("INSERT")) upserts++;
          if (sql.startsWith("DELETE")) prunes++;
          return sqlite.prepare(sql).run(...args);
        }))();
      },
    };
    const background: Promise<unknown>[] = [];
    try {
      for (let i = 0; i < 1000; i++) await recordUnsignedBotRejection({ DB }, "Googlebot/declared", new Date(), (task) => background.push(task));
      expect({ upserts, prunes, ddl }).toEqual({ upserts: 0, prunes: 0, ddl: 0 });
      expect(new Set(background).size).toBe(1);
      await vi.advanceTimersByTimeAsync(BOT_METRICS_FLUSH_MS);
      await Promise.all(background);
      expect({ upserts, prunes, ddl }).toEqual({ upserts: 1, prunes: 1, ddl: 1 });
      const metrics = await readUnsignedBotRejections({ DB });
      expect(metrics.periods[0].googlebot).toBe(1000);
      expect(metrics.approximate).toBe(true);
      for (let i = 0; i < 1000; i++) await recordUnsignedBotRejection({ DB }, "Googlebot/declared");
      await vi.advanceTimersByTimeAsync(BOT_METRICS_FLUSH_MS);
      expect(upserts).toBe(2);
      expect((await readUnsignedBotRejections({ DB })).periods[0].googlebot).toBe(2000);
    } finally { vi.useRealTimers(); sqlite.close(); }
  });
});
