import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordUnsignedBotRejection, readUnsignedBotRejections, unsignedBotFamily } from "../../packages/trust-layer/src/ledger/unsigned-bot-metrics";
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
        run: async () => statement.run(...args),
        all: async () => ({ results: statement.all(...args) }),
      });
      return { ...bound(), bind: (...args: unknown[]) => bound(args) };
    } };
    try {
      const now = new Date("2026-10-22");
      await Promise.all(Array.from({ length: 30 }, () => recordUnsignedBotRejection({ DB }, "bingbot", now)));
      expect((await readUnsignedBotRejections({ DB }, now)).periods[0].bingbot).toBe(30);
    } finally { sqlite.close(); }
  });
});
