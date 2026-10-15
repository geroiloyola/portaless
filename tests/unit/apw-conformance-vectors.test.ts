/**
 * APW conformance suite.
 *
 * This is the first time the published test vectors are actually executed.
 * APW-VECTORS-v1.3.md states that an implementation outside Portaless can verify
 * compatibility from the document alone; until this test existed, nothing in CI
 * checked that claim, and nothing checked the vectors at all.
 *
 * The runner imports only from the package's public entry point, so a passing
 * suite is also evidence that the published surface is sufficient for the
 * vectors it passes -- which is exactly what a third-party implementer needs.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runVector,
  checkSurfaceConstants,
  formatReport,
  type ConformanceReport,
  type VectorReport,
} from "../../packages/apw-resolver/conformance/run";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = join(HERE, "..", "..", "docs", "protocol-apw", "vectors", "v1.3");

interface IndexEntry {
  file: string;
  id: string;
  minimalInterop: boolean;
}

const index = JSON.parse(readFileSync(join(VECTORS_DIR, "manifest.json"), "utf8")) as {
  spec: string;
  vectorFiles: IndexEntry[];
};

const files = readdirSync(VECTORS_DIR)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .sort();

const missingConstants = checkSurfaceConstants();

let reports: VectorReport[] = [];
let report: ConformanceReport;

beforeAll(async () => {
  reports = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(VECTORS_DIR, f), "utf8")) as Record<string, unknown>;
    reports.push(await runVector(raw));
  }
  report = {
    spec: index.spec,
    vectorsVersion: "v1.3",
    ok: reports.every((r) => r.failed === 0) && missingConstants.length === 0,
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
});

describe("APW conformance suite (APW-VECTORS v1.3)", () => {
  it("every vector file listed in the index exists, and every file is listed", () => {
    const listed = index.vectorFiles.map((e) => e.file).sort();
    expect(files).toEqual(listed);
  });

  it("the index and the vector files agree on spec version", () => {
    expect(index.spec).toBe("APW-SPEC-v1.3");
    for (const r of reports) expect(r.specSection.length).toBeGreaterThan(0);
  });

  it("the scoring constants the vectors depend on are on the published surface", () => {
    expect(missingConstants).toEqual([]);
  });

  it("executes at least one case per vector file", () => {
    expect(reports.length).toBeGreaterThanOrEqual(8);
    for (const r of reports) {
      expect(r.total, `${r.vector} no ejecuto ningun caso`).toBeGreaterThan(0);
    }
  });

  it("has no fixture kind without an executor", () => {
    const unsupported = reports.flatMap((r) => r.results.filter((x) => x.status === "unsupported"));
    expect(
      unsupported.map((u) => `${u.vector}/${u.label}`),
      "un kind de fixture sin executor significa que ese vector no se esta comprobando"
    ).toEqual([]);
  });

  it("every vector passes against the published surface", () => {
    const failures = reports.flatMap((r) => r.results.filter((x) => x.status === "fail"));
    const summary = formatReport(report);
    expect(
      failures.map((f) => `${f.vector} [${f.group}] ${f.label}: ${f.detail ?? ""}`),
      summary
    ).toEqual([]);
  });

  it("reports which minimal interoperability vectors are still missing", () => {
    // APW-VECTORS v1.3: "v1.3 requires V-01, V-03, V-05, V-06, V-08 and V-09 as
    // minimal interoperability vectors". V-06 is knowingly absent: its 12-step
    // validation order lives in packages/trust-layer, so it is not implementable
    // from the published package alone. Recorded as a Phase 7 blocker rather
    // than silently dropped.
    const required = ["V-01", "V-03", "V-05", "V-06", "V-08", "V-09"];
    const executed = reports.filter((r) => r.minimalInterop).map((r) => r.vector);
    expect(required.filter((v) => !executed.includes(v))).toEqual(["V-06"]);
  });
});