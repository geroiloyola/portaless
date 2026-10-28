import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

describe("schema.sql covers runtime-created auth/trust tables (M-10)", () => {
  it("creates password_change_events and site_trust_read_policies on a clean install", () => {
    const db = new Database(":memory:");
    db.exec(readFileSync(join(process.cwd(), "schema.sql"), "utf-8"));

    const columns = (table: string) =>
      db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row: any) => row.name);

    expect(columns("password_change_events")).toEqual(
      expect.arrayContaining(["id", "username", "kind", "occurred_at", "ip", "user_agent", "country", "city"])
    );
    expect(columns("site_trust_read_policies")).toEqual(
      expect.arrayContaining([
        "site_id", "enabled", "require_apw_identity", "min_r01", "min_r01_weight",
        "min_r05", "min_r05_weight", "on_fail", "public_overrides", "updated_at", "updated_by",
      ])
    );
    db.close();
  });
});
