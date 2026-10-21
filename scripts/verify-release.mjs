#!/usr/bin/env node
// C41 release acceptance. Runs the automatable evidence required by the final
// release gate. External ChatGPT/API/Cloudum checks and an independent human
// review are deliberately not simulated here; see docs/testing/release-acceptance.md.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TSX = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");
const steps = [];

function fail(message) {
  console.error(`\n[release] FAILED: ${message}`);
  process.exit(1);
}

function run(id, command, args, options = {}) {
  const started = Date.now();
  console.log(`\n[release] ${id}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    timeout: options.timeout ?? 20 * 60_000,
  });
  if (result.error) fail(`${id}: ${result.error.message}`);
  if (result.status !== 0) fail(`${id}: exit ${result.status}`);
  const elapsed = Date.now() - started;
  steps.push({ id, elapsedMs: elapsed });
  console.log(`[release] ${id}: OK (${elapsed} ms)`);
}

function cleanInstall() {
  const temp = mkdtempSync(join(tmpdir(), "portaless-release-install-"));
  try {
    copyFileSync(join(ROOT, "package.json"), join(temp, "package.json"));
    copyFileSync(join(ROOT, "package-lock.json"), join(temp, "package-lock.json"));
    const packages = join(ROOT, "packages");
    for (const name of readdirSync(packages)) {
      const manifest = join(packages, name, "package.json");
      if (!existsSync(manifest)) continue;
      const target = join(temp, "packages", name);
      mkdirSync(target, { recursive: true });
      copyFileSync(manifest, join(target, "package.json"));
    }
    run("lockfile-install", "npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: temp,
      timeout: 15 * 60_000,
    });
    if (!existsSync(join(temp, "node_modules/astro"))) fail("lockfile-install: astro was not installed");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function buildWithBase() {
  const outDir = mkdtempSync(join(tmpdir(), "portaless-release-base-"));
  try {
    run("build-base-portaless", "npm", ["run", "build"], {
      env: { PORTALESS_BASE_PATH: "/portaless/", PORTALESS_OUT_DIR: outDir },
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    if (!html.includes("/portaless/")) fail("build-base-portaless: output does not carry the /portaless/ base");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

console.log(`[release] root: ${resolve(ROOT)}`);
cleanInstall();
run("unit-and-e2e", process.execPath, [VITEST, "run"]);
run("private-export-negative", process.execPath, ["--import", "tsx", "scripts/test-public-export.mjs"]);
run("source-package-boundary", process.execPath, ["scripts/verify-npm-source-boundary.mjs"]);
run("build-normal", "npm", ["run", "build"]);
buildWithBase();
run("resource-budget", "npm", ["run", "test:resources"]);
run("playwright-mobile-and-flows", "npx", ["playwright", "test"]);
run("diff-check", "git", ["diff", "--check"]);

console.log(`\n[release] PASS — ${steps.length} checks`);
for (const step of steps) console.log(`[release]   ${step.id}: ${step.elapsedMs} ms`);
console.log("[release] External ChatGPT/API/Cloudum checks and independent human review remain outside this script.");
