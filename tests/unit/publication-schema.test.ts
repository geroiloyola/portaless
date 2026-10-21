import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS } from "../../packages/persistence-migrations/src/index";

const root = join(__dirname, "../..");

describe("C34 publication schema", () => {
  it("keeps publication_runs in migration v9 and the schema addition", () => {
    const migration = MIGRATIONS.find((entry) => entry.version === 9);
    expect(migration?.name).toBe("publication_runs");
    expect(migration?.createsTables?.publication_runs).toContain("snapshot_hash");
    const sql = readFileSync(join(root, "schema-additions/publication-runs.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS publication_runs");
    expect(sql).toContain("snapshot_hash");
    expect(sql).toContain("revision_ids_json");
  });
});
