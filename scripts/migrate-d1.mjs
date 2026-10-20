#!/usr/bin/env node
// D1 runner: verify schema, export a pre-migration backup, apply deltas in order,
// and write each ledger row only after its SQL has completed successfully.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseArgs(argv) {
  const options = { db: null, mode: null, config: null, persistTo: null, dryRun: false, backupDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") options.db = argv[++i];
    else if (arg === "--local" || arg === "--remote") {
      if (options.mode) throw new Error("Usa solo uno: --local o --remote");
      options.mode = arg;
    } else if (arg === "-c" || arg === "--config") options.config = argv[++i];
    else if (arg === "--persist-to") options.persistTo = argv[++i];
    else if (arg === "--backup-dir") options.backupDir = resolve(argv[++i]);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!options.db || !options.mode) throw new Error("Uso: migrate:d1 --db <DB> --local|--remote [--dry-run]");
  return options;
}

function wrangler(options, args, json = false) {
  const full = ["wrangler", "d1", "execute", options.db, options.mode, ...args];
  if (options.config) full.push("-c", options.config);
  if (options.persistTo && options.mode === "--local") full.push("--persist-to", options.persistTo);
  if (json) full.push("--json");
  return execFileSync("npx", full, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function rows(options, sql) {
  const parsed = JSON.parse(wrangler(options, ["--command", sql], true));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function migrationSql(statements) {
  return statements.map((statement) => `${statement.trim().replace(/;+$/, "")};`).join("\n") + "\n";
}

function missingColumns(schema, contract) {
  const missing = [];
  for (const [table, required] of Object.entries(contract)) {
    const columns = new Set(schema[table] ?? []);
    if (!(table in schema)) missing.push(`${table} (tabla)`);
    for (const column of required) if (!columns.has(column)) missing.push(`${table}.${column}`);
  }
  return missing;
}

export async function migrateD1(options) {
  const { MIGRATIONS, REQUIRED_SCHEMA_COLUMNS, BASELINE_REQUIRED_COLUMNS, assertCompatible, schemaVersion } =
    await import("../packages/persistence-migrations/src/index.ts");
  const tables = rows(options, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((row) => row.name);
  if (tables.length === 0) return { from: 0, to: 0, applied: [], backupPath: null, dryRun: Boolean(options.dryRun) };

  const schema = {};
  const allTables = new Set([
    ...Object.keys(REQUIRED_SCHEMA_COLUMNS),
    ...MIGRATIONS.flatMap((migration) => (migration.addColumns ?? []).map((item) => item.table)),
  ]);
  for (const table of allTables) {
    schema[table] = tables.includes(table)
      ? rows(options, `SELECT name FROM pragma_table_info(${q(table)})`).map((row) => row.name)
      : [];
  }

  const hasLedger = tables.includes("schema_migrations");
  const ledgerRows = hasLedger ? rows(options, "SELECT version, name FROM schema_migrations ORDER BY version") : [];
  const from = ledgerRows.reduce((max, row) => Math.max(max, Number(row.version)), 0);
  assertCompatible(from);
  const expected = new Map(MIGRATIONS.map((migration) => [migration.version, migration.name]));
  const seen = new Set();
  for (const row of ledgerRows) {
    const version = Number(row.version);
    if (seen.has(version) || expected.get(version) !== row.name) throw new Error(`Ledger D1 invalido en version ${version}.`);
    seen.add(version);
  }
  for (let version = 1; version <= from; version++) {
    if (!seen.has(version)) throw new Error(`Ledger D1 incompleto: falta version ${version}.`);
  }

  const baselineMissing = missingColumns(schema, BASELINE_REQUIRED_COLUMNS);
  if (baselineMissing.length) throw new Error(`No se puede migrar/adoptar D1: faltan columnas base: ${baselineMissing.join(", ")}`);
  const pending = MIGRATIONS.filter((migration) => migration.version > from);
  const projected = Object.fromEntries(Object.entries(schema).map(([table, columns]) => [table, [...columns]]));
  for (const migration of pending) {
    for (const { table, column } of migration.addColumns ?? []) {
      if (table in projected && !projected[table].includes(column)) projected[table].push(column);
    }
    for (const [table, columns] of Object.entries(migration.createsTables ?? {})) {
      projected[table] = [...new Set([...(projected[table] ?? []), ...columns])];
    }
  }
  const contractMissing = missingColumns(projected, REQUIRED_SCHEMA_COLUMNS);
  if (contractMissing.length) throw new Error(`D1 no puede llegar al contrato actual con estas migraciones: ${contractMissing.join(", ")}`);

  if (options.dryRun) {
    return { from, to: schemaVersion(), applied: pending.map((migration) => migration.name), backupPath: null, dryRun: true };
  }

  let backupPath = null;
  if (!options.skipBackup) {
    const backupDir = options.backupDir ?? join(process.cwd(), "backups", "d1");
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = join(backupDir, `${options.db}-${timestamp}.sql`);
    const exportArgs = ["wrangler", "d1", "export", options.db, options.mode, `--output=${backupPath}`];
    if (options.config) exportArgs.push("-c", options.config);
    if (options.persistTo && options.mode === "--local") exportArgs.push("--persist-to", options.persistTo);
    execFileSync("npx", exportArgs, { encoding: "utf8", stdio: "inherit" });
    if (!existsSync(backupPath)) throw new Error(`wrangler no produjo el backup esperado: ${backupPath}`);
  }

  const workDir = resolve(join(tmpdir(), `portaless-d1-migrate-${process.pid}-${Date.now()}`));
  mkdirSync(workDir, { recursive: true });
  const applied = [];
  try {
    let liveSchema = schema;
    for (const migration of pending) {
      const statements = [];
      for (const { table, column, type } of migration.addColumns ?? []) {
        if (liveSchema[table] && !liveSchema[table].includes(column)) {
          statements.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
          liveSchema[table].push(column);
        }
      }
      statements.push(...migration.statements);
      statements.push(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES (${migration.version}, ${q(migration.name)}, ${q(new Date().toISOString())});`,
      );
      const file = join(workDir, `v${migration.version}.sql`);
      writeFileSync(file, migrationSql(statements), { mode: 0o600 });
      const args = ["wrangler", "d1", "execute", options.db, options.mode, `--file=${file}`];
      if (options.config) args.push("-c", options.config);
      if (options.persistTo && options.mode === "--local") args.push("--persist-to", options.persistTo);
      execFileSync("npx", args, { encoding: "utf8", stdio: "inherit" });
      applied.push(migration.name);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const finalTables = rows(options, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((row) => row.name);
  const finalSchema = {};
  for (const table of Object.keys(REQUIRED_SCHEMA_COLUMNS)) {
    finalSchema[table] = finalTables.includes(table)
      ? rows(options, `SELECT name FROM pragma_table_info(${q(table)})`).map((row) => row.name)
      : [];
  }
  const missing = missingColumns(finalSchema, REQUIRED_SCHEMA_COLUMNS);
  if (missing.length) throw new Error(`D1 quedó incompleta después de migrar: ${missing.join(", ")}. Backup: ${backupPath}`);
  return { from, to: schemaVersion(), applied, backupPath, dryRun: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await migrateD1(options);
  console.log(`[migrate:d1] ${result.from} -> ${result.to}; aplicadas: ${result.applied.join(", ") || "ninguna"}`);
  if (result.backupPath) console.log(`[migrate:d1] backup: ${result.backupPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[migrate:d1] ERROR: ${error?.message ?? error}`);
    process.exit(1);
  });
}
