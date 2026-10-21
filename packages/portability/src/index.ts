// Canonical-node portability (C36). The database is the canonical state:
// pages, immutable revisions, approvals, settings and history. A backup copies
// it consistently and records checksums. Secrets are excluded by default; an
// explicit opt-in writes a separate 0600 file and never puts values in logs.

import { createHash, randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const BACKUP_FORMAT = "portaless-canonical-backup-v1";
export const BACKUP_VERSION = "1.0";
export const WRITER_LOCK_FILE = "portaless-writer.json";

const SECRET_ENV_KEYS = [
  "PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY",
  "PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY",
  "PORTALESS_INTERNAL_BRIDGE_TOKEN",
  "PORTALESS_OPENAI_API_KEY",
  "PORTALESS_CLOUDFLARE_API_TOKEN",
] as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  source: { sqlitePath: string; schemaVersion: number | null };
  database: { file: string; sha256: string; bytes: number };
  secrets: { included: boolean; file: string | null; keys: string[]; note: string };
}

export interface BackupResult {
  directory: string;
  manifest: BackupManifest;
}

export async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  digest.update(await readFile(path));
  return digest.digest("hex");
}

function schemaVersion(db: any): number | null {
  try {
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
    return row && Number.isInteger(row.version) ? row.version : null;
  } catch {
    return null;
  }
}

async function openDb(path: string, readonly = true): Promise<any> {
  const Database = (await import("better-sqlite3")).default;
  return new Database(path, readonly ? { readonly: true, fileMustExist: true } : { fileMustExist: true });
}

export async function createCanonicalBackup(input: {
  sqlitePath: string;
  outputDir: string;
  includeSecrets?: boolean;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}): Promise<BackupResult> {
  const source = resolve(input.sqlitePath);
  const output = resolve(input.outputDir);
  await access(source);
  await mkdir(output, { recursive: true });
  const databaseFile = "canonical.sqlite";
  const databasePath = join(output, databaseFile);

  const db = await openDb(source, true);
  try {
    const version = schemaVersion(db);
    await db.backup(databasePath);
    const bytes = (await readFile(databasePath)).byteLength;
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      source: { sqlitePath: source, schemaVersion: version },
      database: { file: databaseFile, sha256: await sha256File(databasePath), bytes },
      secrets: {
        included: false,
        file: null,
        keys: [],
        note: "Secrets are excluded by default. Set includeSecrets only for an explicit, access-controlled restore bundle.",
      },
    };
    if (input.includeSecrets) {
      const env = input.env ?? {};
      const values = Object.fromEntries(SECRET_ENV_KEYS
        .filter((key) => typeof env[key] === "string" && env[key])
        .map((key) => [key, env[key] as string]));
      if (Object.keys(values).length > 0) {
        const secretPath = join(output, "secrets.json");
        await writeFile(secretPath, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
        await chmod(secretPath, 0o600);
        manifest.secrets = {
          included: true,
          file: "secrets.json",
          keys: Object.keys(values),
          note: "Separate file, mode 0600. Restore it only on the target node; never commit or upload it.",
        };
      }
    }
    await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return { directory: output, manifest };
  } finally {
    db.close();
  }
}

export async function verifyCanonicalBackup(directory: string): Promise<BackupManifest> {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) throw new Error("unsupported_backup_format");
  const databasePath = join(root, manifest.database.file);
  const actual = await sha256File(databasePath);
  if (actual !== manifest.database.sha256) throw new Error("backup_checksum_mismatch");
  if (manifest.secrets.included) {
    const secretPath = join(root, manifest.secrets.file as string);
    await access(secretPath);
  }
  return manifest;
}

export async function assertNoActiveWriter(dataDir: string, force = false): Promise<void> {
  const lock = join(resolve(dataDir), WRITER_LOCK_FILE);
  try {
    await access(lock);
    if (!force) throw new Error("active_writer_detected");
  } catch (err) {
    if (err instanceof Error && err.message === "active_writer_detected") throw err;
  }
}

export async function activateWriter(dataDir: string, owner = "restored-node"): Promise<string> {
  const root = resolve(dataDir);
  await mkdir(root, { recursive: true });
  const lock = join(root, WRITER_LOCK_FILE);
  const record = { owner, activatedAt: new Date().toISOString(), token: randomUUID() };
  await writeFile(lock, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return record.token;
}

export interface RestoreResult {
  manifest: BackupManifest;
  counts: { pages: number; revisions: number; approvals: number };
  writerToken: string;
}

export async function restoreCanonicalBackup(input: {
  backupDir: string;
  targetSqlitePath: string;
  overwrite?: boolean;
  activate?: boolean;
}): Promise<RestoreResult> {
  const manifest = await verifyCanonicalBackup(input.backupDir);
  const target = resolve(input.targetSqlitePath);
  const targetDir = dirname(target);
  if (!input.overwrite) {
    try {
      await access(target);
      throw new Error("target_exists");
    } catch (err) {
      if (err instanceof Error && err.message === "target_exists") throw err;
    }
  }
  await assertNoActiveWriter(targetDir, Boolean(input.overwrite));
  await mkdir(targetDir, { recursive: true });
  await copyFile(join(resolve(input.backupDir), manifest.database.file), target);
  const db = await openDb(target, true);
  let counts;
  try {
    counts = {
      pages: Number(db.prepare("SELECT COUNT(*) AS n FROM pages").get()?.n ?? 0),
      revisions: Number(db.prepare("SELECT COUNT(*) AS n FROM page_revisions").get()?.n ?? 0),
      approvals: Number(db.prepare("SELECT COUNT(*) AS n FROM page_revision_approvals").get()?.n ?? 0),
    };
  } finally {
    db.close();
  }
  const writerToken = input.activate === false ? "" : await activateWriter(targetDir);
  return { manifest, counts, writerToken };
}

export function secretEnvironmentKeys(): readonly string[] {
  return SECRET_ENV_KEYS;
}
