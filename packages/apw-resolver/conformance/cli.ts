#!/usr/bin/env node
/**
 * `apw-conformance` -- run the published APW test vectors against an
 * implementation, from outside this repository.
 *
 * Usage:
 *   npx apw-conformance <path-to-vectors-dir>
 *   npx apw-conformance                 # defaults to ./apw-vectors/v1.3
 *
 * The vectors are CC BY 4.0 and independent of any code: download
 * `docs/protocol-apw/vectors/v1.3/` from the specification repository and point
 * this at it. This is the exit condition of ROADMAP Phase 7 -- a third party can
 * obtain a comparable pass/fail without reading Portaless's source.
 *
 * Exit code 0 when every executed case passes, 1 otherwise. Vectors with no
 * executor for their case kinds are reported as `unsupported` and also fail,
 * because an unexecuted vector is not a passing vector.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runVector, checkSurfaceConstants, formatReport } from "./run.js";
import type { ConformanceReport, VectorReport } from "./run.js";

async function loadFrom(dir: string): Promise<VectorReport[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort();
  const reports: VectorReport[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
    reports.push(await runVector(raw));
  }
  return reports;
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? "apw-vectors/v1.3";
  const dir = resolve(process.cwd(), arg);

  if (!existsSync(dir)) {
    console.error(`apw-conformance: no vector directory at ${dir}`);
    console.error("");
    console.error("Usage: npx apw-conformance <path-to-vectors-dir>");
    console.error("Download the vectors from the specification repository:");
    console.error("  docs/protocol-apw/vectors/v1.3/   (CC BY 4.0, independent of the code)");
    process.exit(2);
  }

  let reports: VectorReport[];
  try {
    reports = await loadFrom(dir);
  } catch (e) {
    console.error(`apw-conformance: could not read the vectors: ${(e as Error).message}`);
    process.exit(2);
  }

  const missingConstants = checkSurfaceConstants();
  const report: ConformanceReport = {
    spec: "APW-SPEC-v1.3",
    vectorsVersion: "v1.3",
    ok: reports.every((r) => r.failed === 0 && r.unsupported === 0) && missingConstants.length === 0,
    total: reports.reduce((n, r) => n + r.total, 0),
    passed: reports.reduce((n, r) => n + r.passed, 0),
    failed: reports.reduce((n, r) => n + r.failed, 0),
    unsupported: reports.reduce((n, r) => n + r.unsupported, 0),
    minimalInteropRequired: reports.filter((r) => r.minimalInterop).map((r) => r.vector),
    minimalInteropSatisfied: reports
      .filter((r) => r.minimalInterop)
      .every((r) => r.failed === 0 && r.unsupported === 0),
    vectors: reports,
  };

  console.log(formatReport(report));
  if (missingConstants.length) {
    console.log(`missing from the surface: ${missingConstants.join(", ")}`);
  }
  console.log(`vectors directory: ${dir}`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(`apw-conformance: ${(e as Error).message}`);
  process.exit(2);
});