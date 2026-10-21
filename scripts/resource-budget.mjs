#!/usr/bin/env node
// C39 reference resource budget. Seeds a deterministic dataset, measures the
// SQLite canon, a verified backup and a restore, then enforces 2 GiB RAM and
// 20 GiB disk. This is a local reference measurement, not a Cloudum SLA.

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPageStore } from "../packages/atomic-elements/src/persistence/store-factory.ts";
import { createCanonicalBackup, restoreCanonicalBackup } from "../packages/portability/src/index.ts";
import { evaluateResourceBudget, REFERENCE_RESOURCE_BUDGET } from "../packages/deploy-engine/src/resource-budget.ts";
import { applySchema } from "./setup.mjs";

const PAGES = Number(process.env.PORTALESS_RESOURCE_PAGES || 200);
const REVISIONS_PER_PAGE = Number(process.env.PORTALESS_RESOURCE_REVISIONS || 5);
const dir = mkdtempSync(join(tmpdir(), "portaless-resource-"));
const dbPath = join(dir, "canon.sqlite");
const backupDir = join(dir, "backup");
const restorePath = join(dir, "restored.sqlite");

function bytes(path) { try { return statSync(path).size; } catch { return 0; } }

try {
  await applySchema(dbPath, { quiet: true });
  const store = await createPageStore({ PORTALESS_SQLITE_PATH: dbPath });
  const start = Date.now();
  for (let p = 0; p < PAGES; p++) {
    let revision = null;
    for (let r = 0; r < REVISIONS_PER_PAGE; r++) {
      revision = await store.save({
        version: "0.1",
        slug: `page-${p}`,
        title: `Page ${p} revision ${r}`,
        status: "published",
        root: [{ id: `hero-${p}`, type: "Hero", props: { headline: `Page ${p} r${r}` } }],
      }, { expectedRevisionId: r === 0 ? null : revision.revisionId, actor: "resource-budget" });
    }
  }
  const seedMs = Date.now() - start;
  const dbBytes = bytes(dbPath);
  const backupStart = Date.now();
  const backup = await createCanonicalBackup({ sqlitePath: dbPath, outputDir: backupDir });
  const backupMs = Date.now() - backupStart;
  const backupBytes = backup.manifest.database.bytes;
  const restoreStart = Date.now();
  const restored = await restoreCanonicalBackup({ backupDir, targetSqlitePath: restorePath, overwrite: true });
  const restoreMs = Date.now() - restoreStart;
  store.close();
  const rssBytes = process.memoryUsage().rss;
  const report = {
    profile: "portaless-private-node-reference",
    dataset: { pages: PAGES, revisionsPerPage: REVISIONS_PER_PAGE, revisions: PAGES * REVISIONS_PER_PAGE },
    measured: { seedMs, dbBytes, backupBytes, backupMs, restoreMs, restorePages: restored.counts.pages, restoreRevisions: restored.counts.revisions, rssBytes },
    budget: { rssBytes: 2 * 1024 * 1024 * 1024, diskBytes: 20 * 1024 * 1024 * 1024 },
  };
  const budget = evaluateResourceBudget({ rssBytes, databaseBytes: dbBytes, backupBytes });
  report.ok = budget.ok;
  report.violations = budget.violations;
  report.budget = REFERENCE_RESOURCE_BUDGET;
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
