import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyzeTree,
  extractSpecifiers,
  findCycles,
  formatMarkdownSummary,
} from "../../scripts/check-architecture-boundaries.mjs";

const tempDirs: string[] = [];

function makeTempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-boundaries-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("extractSpecifiers", () => {
  test("detects static, type-only, export, dynamic import, and require specifiers while ignoring comments", () => {
    const sample = `
      // import { fake } from "../../sqlite-driver/src/open";
      /*
        export type { AlsoFake } from "../../dashboard/src/x";
        require("../../permissions/src/y");
      */
      import { a } from "@verared/net";
      import type { B } from "../../sqlite-driver/src/open";
      export { c } from "@portaless/auth";
      export type { D } from "../../trust-layer/src/types";
      import "./side-effect.js";
      const dyn = await import("../../deploy-engine/src/draft-filter");
      const req = require("../../dashboard/src/store");
    `;
    const specs = extractSpecifiers(sample).map((s) => s.specifier);
    expect(specs).toEqual([
      "@verared/net",
      "../../sqlite-driver/src/open",
      "@portaless/auth",
      "../../trust-layer/src/types",
      "./side-effect.js",
      "../../deploy-engine/src/draft-filter",
      "../../dashboard/src/store",
    ]);
  });
});

describe("analyzeTree synthetic boundary graphs", () => {
  test("passes cleanly when all imports respect layers and use package entry points", () => {
    const root = makeTempRepo({
      "docs/protocol-apw/tools/check.mjs": `import { readFileSync } from "node:fs";\n`,
      "packages/net/src/index.ts": `export const safeFetch = () => {};\n`,
      "packages/apw-resolver/src/index.ts": `import { safeFetch } from "@verared/net";\nexport { safeFetch };\n`,
      "packages/trust-layer/src/index.ts": `import { safeFetch } from "@verared/net";\nimport { x } from "@verared/apw-resolver";\nexport { safeFetch, x };\n`,
      "packages/plugin-sdk/src/index.ts": `export type Cap = string;\n`,
      "packages/commerce-plugin/src/index.ts": `import type { Cap } from "@portaless/plugin-sdk";\nexport const c: Cap = "content:read";\n`,
      "src/pages/index.astro": `---\nimport { x } from "@portaless/trust-layer";\n---\n`,
    });

    const report = analyzeTree(root);
    expect(report.deepSrcImports.total).toBe(0);
    expect(report.cycles).toEqual([]);
    expect(report.layerViolations.total).toBe(0);
    expect(report.exportReady.ready).toBe(true);
  });

  test("detects cycles, verared->geroiloyola (including type-only), L2->L3, L4->L5, Contracts->code, Extensions->core, and L5 deep src/", () => {
    const root = makeTempRepo({
      "docs/protocol-apw/tools/leak.mjs": `import { x } from "../../../packages/apw-resolver/src/index";\n`,
      "packages/apw-resolver/src/a.ts": `
        import type { Db } from "../../sqlite-driver/src/open";
        import { verify } from "../../trust-layer/src/attest";
      `,
      "packages/trust-layer/src/attest.ts": `
        import { fetchSafe } from "../../apw-resolver/src/safe-fetch";
        import { ddl } from "../../dashboard/src/settings";
      `,
      "packages/mcp-server/src/tool.ts": `
        import { nav } from "../../../src/lib/docs-nav.mjs";
      `,
      "packages/commerce-plugin/src/bridge.ts": `
        import { run } from "../../plugin-sandbox/src/runner";
      `,
      "functions/api/example.js": `
        const mod = require("../../packages/auth/src/service");
      `,
      "src/lib/helper.ts": `
        const lazy = import("../../packages/visual-elements/src/render");
      `,
    });

    const report = analyzeTree(root);
    expect(report.cycles).toEqual([["apw-resolver", "trust-layer"]]);
    expect(report.layerViolations.byType["contracts-to-portaless"]).toBe(1);
    expect(report.layerViolations.byType["verared-to-geroiloyola"]).toBe(2);
    expect(report.layerViolations.byType["l1-to-l2"]).toBe(1);
    expect(report.layerViolations.byType["l4-to-l5"]).toBe(1);
    expect(report.layerViolations.byType["extension-to-core"]).toBe(1);
    expect(report.deepSrcImports.l5).toBe(2);
    expect(report.deepSrcImports.packages).toBe(6);
    expect(report.exportReady.ready).toBe(false);
    expect(report.exportReady.zeroVeraredReverseImports).toBe(false);
  });

  test("findCycles returns deterministic sorted SCCs", () => {
    const adj = new Map([
      ["b", new Set(["a"])],
      ["a", new Set(["b", "c"])],
      ["c", new Set(["d"])],
      ["d", new Set([])],
    ]);
    expect(findCycles(adj)).toEqual([["a", "b"]]);
  });

  test("formatMarkdownSummary renders the metrics and Export-Ready status", () => {
    const root = makeTempRepo({
      "packages/net/src/index.ts": `export const ok = true;\n`,
    });
    const report = analyzeTree(root);
    const md = formatMarkdownSummary(report);
    expect(md).toContain("Architecture Boundaries Gate");
    expect(md).toContain("License boundary violations");
    expect(md).toContain("Export-Ready (Wave 1 -> Wave 2)");
    expect(md).toContain("**READY**");
  });

  test("detects license mismatches and missing LICENSE files across org boundaries", () => {
    const root = makeTempRepo({
      "package.json": JSON.stringify({ name: "root", license: "MIT" }),
      "docs/protocol-apw/package.json": JSON.stringify({ name: "spec", license: "Apache-2.0" }),
      "packages/plugin-sdk/package.json": JSON.stringify({ name: "@portaless/plugin-sdk", license: "AGPL-3.0-or-later" }),
      "packages/net/package.json": JSON.stringify({ name: "@portaless/net", license: "AGPL-3.0-or-later" }),
      "packages/apw-resolver/package.json": JSON.stringify({ name: "@portaless/apw-resolver", license: "Apache-2.0" }),
      "packages/auth/package.json": JSON.stringify({ name: "@portaless/auth", license: "MIT" }),
    });
    const report = analyzeTree(root);
    expect(report.licenseViolations.total).toBe(7);
    expect(report.exportReady.zeroLicenseViolations).toBe(false);
    expect(report.exportReady.ready).toBe(false);
    const reasons = report.licenseViolations.items.map((i) => `${i.file}:${i.reason}`);
    expect(reasons).toContain("package.json:license-mismatch");
    expect(reasons).toContain("docs/protocol-apw/package.json:license-mismatch");
    expect(reasons).toContain("packages/plugin-sdk/package.json:license-mismatch");
    expect(reasons).toContain("packages/net/package.json:license-mismatch");
    expect(reasons).toContain("packages/net/LICENSE:missing-license-file");
    expect(reasons).toContain("packages/apw-resolver/LICENSE:missing-license-file");
    expect(reasons).toContain("packages/auth/package.json:license-mismatch");
  });
});

describe("repository scan and CLI --report / --strict behavior", () => {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const scriptPath = join(repoRoot, "scripts/check-architecture-boundaries.mjs");

  test("scans the real repository without errors and satisfies Export-Ready", () => {
    const report = analyzeTree(repoRoot);
    expect(report.scannedFiles).toBeGreaterThan(100);
    expect(report.layerViolations.byType["contracts-to-portaless"] ?? 0).toBe(0);
    expect(report.layerViolations.total).toBe(0);
    expect(report.cycles).toEqual([]);
    expect(report.deepSrcImports.packages).toBe(0);
    expect(report.deepSrcImports.l5).toBe(0);
    expect(report.deepSrcImports.byTargetOrg.verared).toBe(0);
    expect(report.deepSrcImports.byTargetOrg.geroiloyola).toBe(0);
    expect(report.licenseViolations.total).toBe(0);
    expect(report.exportReady.zeroLicenseViolations).toBe(true);
    expect(report.veraredPinViolations.total).toBe(0);
    expect(report.exportReady.zeroVeraredPinViolations).toBe(true);
    expect(report.exportReady.ready).toBe(true);
  });

  test("CLI --report exits 0 and writes GITHUB_STEP_SUMMARY when configured", () => {
    const dir = makeTempRepo({});
    const summaryPath = join(dir, "summary.md");
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--report"],
      {
        cwd: repoRoot,
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
        encoding: "utf8",
      },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[check-architecture-boundaries]");
    const summary = readFileSync(summaryPath, "utf8");
    expect(summary).toContain("### Architecture Boundaries Gate");
    expect(summary).toContain("Export-Ready (Wave 1 -> Wave 2)");
  });

  test("CLI --strict exits 0 on the real repository", () => {
    const res = spawnSync(process.execPath, [scriptPath, "--strict"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("license violations: 0");
    expect(res.stdout).toContain("export-ready (Wave 1 -> Wave 2): READY");
  });

  test("CLI --strict exits 1 on a synthetic repo with a deep src/ import", () => {
    const root = makeTempRepo({
      "src/lib/leak.ts": `import { x } from "../../packages/net/src/safe-fetch";\nexport { x };\n`,
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("deep packages/*/src/ imports: 1");
    expect(res.stdout).toContain("export-ready (Wave 1 -> Wave 2): NOT READY");
  });

  test("CLI --strict exits 1 on a synthetic repo with a layer/org violation", () => {
    const root = makeTempRepo({
      "packages/trust-layer/src/leak.ts": `import { db } from "@portaless/sqlite-driver";\nexport { db };\n`,
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("verared-to-geroiloyola: 1");
    expect(res.stdout).toContain("export-ready (Wave 1 -> Wave 2): NOT READY");
  });

  test("CLI --strict exits 1 on a synthetic repo with a license violation", () => {
    const root = makeTempRepo({
      "packages/net/package.json": JSON.stringify({ name: "@portaless/net", license: "AGPL-3.0-or-later" }),
      "packages/net/src/index.ts": `export const ok = true;\n`,
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("license violations: 2");
    expect(res.stdout).toContain("export-ready (Wave 1 -> Wave 2): NOT READY");
  });

  test("CLI --strict exits 1 when packages/plugin-sdk is duplicated locally alongside SPEC-PIN.json", () => {
    const root = makeTempRepo({
      "SPEC-PIN.json": JSON.stringify({
        commit: "7787966a38fb08ceb509df295ee814ba93af4dec",
        tag: "v0.1.0-draft.1",
        stack: { version: "0.1.0-alpha.1", tag: "v0.1.0-alpha.1" },
        digests: { corpusDigest: "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA" },
      }),
      "packages/plugin-sdk/package.json": JSON.stringify({ name: "@portaless/plugin-sdk", license: "MIT" }),
      "packages/plugin-sdk/src/index.ts": `export const ok = true;\n`,
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("duplicated-plugin-sdk-package");
  });

  test("CLI --strict exits 1 when site-profiles/demo is duplicated locally alongside SPEC-PIN.json", () => {
    const root = makeTempRepo({
      "SPEC-PIN.json": JSON.stringify({
        commit: "7787966a38fb08ceb509df295ee814ba93af4dec",
        tag: "v0.1.0-draft.1",
        stack: { version: "0.1.0-alpha.1", tag: "v0.1.0-alpha.1" },
        digests: { corpusDigest: "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA" },
      }),
      "site-profiles/demo/home.json": JSON.stringify({ slug: "home", root: [] }),
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("duplicated-demo-templates");
  });

  test("CLI --strict exits 1 when docs/screenshots is reintroduced alongside SPEC-PIN.json", () => {
    const root = makeTempRepo({
      "SPEC-PIN.json": JSON.stringify({
        commit: "7787966a38fb08ceb509df295ee814ba93af4dec",
        tag: "v0.1.0-draft.1",
        stack: { version: "0.1.0-alpha.1", tag: "v0.1.0-alpha.1" },
        digests: { corpusDigest: "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA" },
      }),
      "docs/screenshots/demo.png": "fake-png",
    });
    const res = spawnSync(process.execPath, [scriptPath, "--strict", "--root", root], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("forbidden-docs-screenshots");
  });

  test("CLI --strict accepts @verared/*@0.1.0-rc.1 from registry.npmjs.org with exact version + sha512 and tarballs for spec/sdk/templates", () => {
    const stackPkgs = [
      "@verared/net",
      "@verared/apw",
      "@verared/local-trust",
      "@verared/reputation",
      "@verared/trust-layer",
      "@verared/cloud-images",
      "@verared/identity-atproto",
    ];
    const dependencies: Record<string, string> = {};
    const lockPackages: Record<string, Record<string, string>> = {};
    for (const name of stackPkgs) {
      const short = name.split("/")[1];
      dependencies[name] = "0.1.0-rc.1";
      lockPackages[`node_modules/${name}`] = {
        version: "0.1.0-rc.1",
        resolved: `https://registry.npmjs.org/${name}/-/${short}-0.1.0-rc.1.tgz`,
        integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      };
    }
    lockPackages["node_modules/@verared/spec"] = {
      version: "0.1.0-draft.1",
      resolved: "https://github.com/verared/vera-trust-spec/releases/download/v0.1.0-draft.1/verared-spec-0.1.0-draft.1.tgz",
    };
    lockPackages["node_modules/@portaless/plugin-sdk"] = {
      version: "0.1.0",
      resolved: "https://github.com/geroiloyola/portaless-plugin-sdk/releases/download/v0.1.0/portaless-plugin-sdk-0.1.0.tgz",
    };
    lockPackages["node_modules/@portaless/templates"] = {
      version: "0.1.0",
      resolved: "https://github.com/geroiloyola/portaless-templates/releases/download/v0.1.0/portaless-templates-0.1.0.tgz",
    };

    const specPin = JSON.stringify({
      commit: "7787966a38fb08ceb509df295ee814ba93af4dec",
      tag: "v0.1.0-draft.1",
      stack: { version: "0.1.0-rc.1", tag: "v0.1.0-rc.1" },
      digests: { corpusDigest: "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA" },
    });

    // 1. Valid exact pin + sha512 passes
    const validRoot = makeTempRepo({
      "SPEC-PIN.json": specPin,
      "package.json": JSON.stringify({ name: "portaless", license: "AGPL-3.0-or-later", dependencies }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: lockPackages }),
    });
    const okRes = spawnSync(process.execPath, [scriptPath, "--strict", "--root", validRoot], { cwd: repoRoot, encoding: "utf8" });
    expect(okRes.status, okRes.stdout).toBe(0);

    // 2. Missing sha512 integrity fails
    const noIntegrityPackages = structuredClone(lockPackages);
    delete noIntegrityPackages["node_modules/@verared/net"].integrity;
    const noIntRoot = makeTempRepo({
      "SPEC-PIN.json": specPin,
      "package.json": JSON.stringify({ name: "portaless", license: "AGPL-3.0-or-later", dependencies }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: noIntegrityPackages }),
    });
    const noIntRes = spawnSync(process.execPath, [scriptPath, "--strict", "--root", noIntRoot], { cwd: repoRoot, encoding: "utf8" });
    expect(noIntRes.status).toBe(1);
    expect(noIntRes.stdout).toContain("missing-verared-integrity:@verared/net");

    // 3. Floating range (^ / ~) in package.json fails
    const floatingDeps = { ...dependencies, "@verared/apw": "^0.1.0-rc.1" };
    const floatRoot = makeTempRepo({
      "SPEC-PIN.json": specPin,
      "package.json": JSON.stringify({ name: "portaless", license: "AGPL-3.0-or-later", dependencies: floatingDeps }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: lockPackages }),
    });
    const floatRes = spawnSync(process.execPath, [scriptPath, "--strict", "--root", floatRoot], { cwd: repoRoot, encoding: "utf8" });
    expect(floatRes.status).toBe(1);
    expect(floatRes.stdout).toContain("unpinned-verared-version:@verared/apw");

    // 4. @verared/spec from registry.npmjs.org still fails (tarball required)
    const badSpecPackages = structuredClone(lockPackages);
    badSpecPackages["node_modules/@verared/spec"].resolved = "https://registry.npmjs.org/@verared/spec/-/spec-0.1.0-draft.1.tgz";
    const badSpecRoot = makeTempRepo({
      "SPEC-PIN.json": specPin,
      "package.json": JSON.stringify({ name: "portaless", license: "AGPL-3.0-or-later", dependencies }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: badSpecPackages }),
    });
    const badSpecRes = spawnSync(process.execPath, [scriptPath, "--strict", "--root", badSpecRoot], { cwd: repoRoot, encoding: "utf8" });
    expect(badSpecRes.status).toBe(1);
    expect(badSpecRes.stdout).toContain("invalid-verared-tarball-source:@verared/spec");
  });
});


