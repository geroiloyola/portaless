#!/usr/bin/env node
// E-09: Verificacion unificada de claims, honestidad documental, enlaces locales,
// paridad de runtimes y fronteras arquitectonicas. Reutiliza las suites canonicas
// de Vitest y scripts/check-architecture-boundaries.mjs --strict (cero duplicacion).
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const CLAIM_SUITES = [
  "tests/unit/live-status-claims.test.ts",
  "tests/unit/capability-claims.test.ts",
  "tests/unit/policy-claims.test.ts",
  "tests/unit/mcp-tool-count.test.ts",
  "tests/unit/release-evidence.test.ts",
  "tests/unit/home-honesty.test.ts",
  "tests/unit/legacy-routes-guard.test.ts",
  "tests/unit/ltp-naming.test.ts",
  "tests/unit/docs-links.test.ts",
  "tests/unit/markdown-local-links.test.ts",
  "tests/unit/runtime-parity-matrix.test.ts",
];

function run(cmd, args, label) {
  console.log(`\n[verify:claims] ${label}...`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
}

run(process.execPath, ["scripts/check-architecture-boundaries.mjs", "--strict"], "Architecture boundaries (--strict)");
run(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...CLAIM_SUITES],
  `Claims, honesty, links & parity suites (${CLAIM_SUITES.length} files)`
);

console.log(`\n[verify:claims] OK — boundaries + ${CLAIM_SUITES.length} claim suites passed.`);
