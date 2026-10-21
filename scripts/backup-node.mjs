#!/usr/bin/env node
// Canonical node backup/verify/restore (C36).
//
//   npm run backup
//   npm run backup -- verify <backup-dir>
//   npm run backup -- restore <backup-dir> --overwrite
//
// Backup defaults to `${PORTALESS_DATA_DIR}/backups/<timestamp>`. Secrets are
// excluded unless --include-secrets is passed explicitly; a restore writes a
// single-writer activation record next to the target database.

import { resolve } from "node:path";
import {
  BACKUP_FORMAT,
  createCanonicalBackup,
  restoreCanonicalBackup,
  secretEnvironmentKeys,
  verifyCanonicalBackup,
} from "../packages/portability/src/index.ts";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

async function main() {
  const command = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "backup";
  const sqlitePath = process.env.PORTALESS_SQLITE_PATH || "/data/portaless.db";
  const dataDir = process.env.PORTALESS_DATA_DIR || resolve(sqlitePath, "..");
  if (command === "verify") {
    const dir = process.argv[3] ? resolve(process.argv[3]) : arg("--dir");
    if (!dir) throw new Error("verify requires a backup directory");
    const manifest = await verifyCanonicalBackup(dir);
    console.log(`${BACKUP_FORMAT} OK: ${manifest.database.file} (${manifest.database.bytes} bytes), schema ${manifest.source.schemaVersion ?? "unknown"}`);
    return;
  }
  if (command === "restore") {
    const dir = process.argv[3] ? resolve(process.argv[3]) : arg("--dir");
    if (!dir) throw new Error("restore requires a backup directory");
    const target = arg("--target", sqlitePath);
    const result = await restoreCanonicalBackup({ backupDir: dir, targetSqlitePath: target, overwrite: flag("--overwrite") });
    console.log(`Restored ${result.counts.pages} pages, ${result.counts.revisions} revisions, ${result.counts.approvals} approvals into ${resolve(target)}.`);
    if (result.writerToken) console.log(`Writer activation recorded; token ${result.writerToken.slice(0, 8)}… (full value is in ${resolve(target, "..")}/portaless-writer.json).`);
    return;
  }
  if (command !== "backup") throw new Error(`unknown command: ${command}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = arg("--dir", resolve(dataDir, "backups", stamp));
  const result = await createCanonicalBackup({
    sqlitePath,
    outputDir,
    includeSecrets: flag("--include-secrets"),
    env: process.env,
  });
  console.log(`Backup written to ${result.directory}`);
  console.log(`Database ${result.manifest.database.bytes} bytes, sha256 ${result.manifest.database.sha256}`);
  console.log(`Secrets policy: ${result.manifest.secrets.included ? `separate file with ${result.manifest.secrets.keys.length} key(s)` : "excluded"}.`);
  if (result.manifest.secrets.included) console.log(`Explicit opt-in used. Keep secrets.json offline; never commit it. Keys tracked: ${secretEnvironmentKeys().join(", ")}`);
}

main().catch((error) => { console.error(`[backup] ${error?.message ?? error}`); process.exit(1); });
