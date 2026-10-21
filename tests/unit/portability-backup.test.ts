import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import {
  createCanonicalBackup,
  restoreCanonicalBackup,
  verifyCanonicalBackup,
} from "../../packages/portability/src/index.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function seededDb() {
  const dir = mkdtempSync(join(tmpdir(), "portaless-backup-"));
  dirs.push(dir);
  const sqlitePath = join(dir, "canon.sqlite");
  await applySchema(sqlitePath, { quiet: true });
  const store = await createPageStore({ PORTALESS_SQLITE_PATH: sqlitePath });
  const first = await store.save({ version: "0.1", slug: "home", title: "v1", status: "published", root: [] }, { expectedRevisionId: null, actor: "owner" });
  await store.save({ version: "0.1", slug: "home", title: "v2", status: "published", root: [] }, { expectedRevisionId: first.revisionId, actor: "owner" });
  store.close();
  return { dir, sqlitePath };
}

describe("C36 canonical-node backup and restore", () => {
  it("creates a checksummed backup, excludes secrets by default, and restores canonical state", async () => {
    const { dir, sqlitePath } = await seededDb();
    const backupDir = join(dir, "backup");
    const backup = await createCanonicalBackup({ sqlitePath, outputDir: backupDir });
    expect(backup.manifest).toMatchObject({ format: "portaless-canonical-backup-v1", secrets: { included: false, file: null } });
    expect(backup.manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(backup.manifest.source.schemaVersion).toBeGreaterThanOrEqual(9);
    await expect(verifyCanonicalBackup(backupDir)).resolves.toMatchObject({ database: { sha256: backup.manifest.database.sha256 } });

    const target = join(dir, "restored.sqlite");
    const restored = await restoreCanonicalBackup({ backupDir, targetSqlitePath: target, overwrite: true });
    expect(restored.counts).toMatchObject({ pages: 1, revisions: 2, approvals: 2 });
    expect(restored.writerToken).toBeTruthy();
    expect(() => statSync(join(dir, "portaless-writer.json"))).not.toThrow();
  });

  it("puts secrets in a separate 0600 file only when explicitly requested", async () => {
    const { dir, sqlitePath } = await seededDb();
    const backupDir = join(dir, "backup-secrets");
    const backup = await createCanonicalBackup({
      sqlitePath,
      outputDir: backupDir,
      includeSecrets: true,
      env: { PORTALESS_OPENAI_API_KEY: "sk-secret", OTHER: "ignored" },
    });
    expect(backup.manifest.secrets).toMatchObject({ included: true, file: "secrets.json", keys: ["PORTALESS_OPENAI_API_KEY"] });
    const mode = statSync(join(backupDir, "secrets.json")).mode & 0o777;
    expect(mode).toBe(0o600);
    await expect(verifyCanonicalBackup(backupDir)).resolves.toBeTruthy();
  });

  it("rejects a tampered backup instead of restoring it", async () => {
    const { dir, sqlitePath } = await seededDb();
    const backupDir = join(dir, "backup");
    await createCanonicalBackup({ sqlitePath, outputDir: backupDir });
    const db = join(backupDir, "canonical.sqlite");
    const { appendFileSync } = await import("node:fs");
    appendFileSync(db, "tampered");
    await expect(verifyCanonicalBackup(backupDir)).rejects.toThrow("backup_checksum_mismatch");
  });
});
