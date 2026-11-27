// Architecture import-boundary analyzer (ROADMAP P2 E-07).
// Modes:
//   --report (default): prints deterministic baseline metrics and exits 0.
//   --strict: exits 1 on any cycle, layer/org violation, or deep src/ import.
//   --json: prints machine-readable JSON report.
// When GITHUB_STEP_SUMMARY is set, appends a Markdown summary table.
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs", ".astro"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".astro",
  "coverage",
  "test-results",
  ".venv",
  "__pycache__",
]);
const L5_ROOTS = ["src", "functions", "server", "scripts"];

export const PACKAGE_LAYERS = Object.freeze({
  // Contracts
  "docs/protocol-apw": { layer: "Contracts", org: "verared" },
  "plugin-sdk": { layer: "Contracts", org: "geroiloyola" },
  // L0-net (neutral)
  net: { layer: "L0-net", org: "verared" },
  // L1 Vera Trust Stack core
  "apw-resolver": { layer: "L1", org: "verared" },
  "ltp-engine": { layer: "L1", org: "verared" },
  "ltp-reputation": { layer: "L1", org: "verared" },
  // L2 Neutral Trust Layer
  "trust-layer": { layer: "L2", org: "verared" },
  "cloud-images": { layer: "L2", org: "verared" },
  "identity-atproto": { layer: "L2", org: "verared" },
  // Node L0 (Portaless host persistence & services)
  "sqlite-driver": { layer: "Node-L0", org: "geroiloyola" },
  "persistence-migrations": { layer: "Node-L0", org: "geroiloyola" },
  "email-transport": { layer: "Node-L0", org: "geroiloyola" },
  "trust-storage-adapters": { layer: "Node-L0", org: "geroiloyola" },
  // L3 CMS kernel
  "visual-elements": { layer: "L3", org: "geroiloyola" },
  "deploy-engine": { layer: "L3", org: "geroiloyola" },
  auth: { layer: "L3", org: "geroiloyola" },
  dashboard: { layer: "L3", org: "geroiloyola" },
  permissions: { layer: "L3", org: "geroiloyola" },
  "plugin-sandbox": { layer: "L3", org: "geroiloyola" },
  portability: { layer: "L3", org: "geroiloyola" },
  onboarding: { layer: "L3", org: "geroiloyola" },
  "ai-provider": { layer: "L3", org: "geroiloyola" },
  // L4 Surfaces
  "mcp-server": { layer: "L4", org: "geroiloyola" },
  // Extensions (plugins)
  "commerce-plugin": { layer: "Extensions", org: "geroiloyola" },
  "posse-syndicator-plugin": { layer: "Extensions", org: "geroiloyola" },
  // L5 Composition roots
  src: { layer: "L5", org: "geroiloyola" },
  functions: { layer: "L5", org: "geroiloyola" },
  server: { layer: "L5", org: "geroiloyola" },
  scripts: { layer: "L5", org: "geroiloyola" },
});

// Explicit acyclic intra-layer edges permitted by docs/architecture/ARCHITECTURE.md §3.
export const INTRA_LAYER_ALLOWLIST = new Set([
  "cloud-images->trust-layer",
  "identity-atproto->trust-layer",
  "persistence-migrations->sqlite-driver",
  "trust-storage-adapters->sqlite-driver",
  "deploy-engine->visual-elements",
  "dashboard->auth",
  "plugin-sandbox->permissions",
  "onboarding->visual-elements",
]);

const ALLOWED_TARGET_LAYERS = Object.freeze({
  Contracts: new Set(),
  "L0-net": new Set(),
  L1: new Set(["L0-net"]),
  L2: new Set(["L1", "L0-net"]),
  "Node-L0": new Set(["L2", "L1", "L0-net"]),
  L3: new Set(["L2", "L1", "L0-net", "Node-L0", "Contracts"]),
  L4: new Set(["L3", "L2", "L1", "L0-net", "Node-L0", "Contracts"]),
  L5: new Set(["L4", "L3", "L2", "L1", "L0-net", "Node-L0", "Contracts", "Extensions", "L5"]),
  Extensions: new Set(["Contracts"]),
});

function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    // Preserve string literals so comment markers inside strings are untouched.
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = source[i];
        out += c;
        if (c === "\\" && i + 1 < n) {
          i++;
          out += source[i];
        } else if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Extracts static imports/exports (including `import type` / `export type`),
 * side-effect imports, dynamic `import(...)`, and `require(...)` specifiers.
 */
export function extractSpecifiers(source) {
  const clean = stripComments(source);
  const results = [];
  const patterns = [
    // import ... from 'x' | import type ... from 'x' | export ... from 'x' | export type ... from 'x'
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)["']([^"']+)["']/g,
    // side-effect: import 'x'
    /\bimport\s+["']([^"']+)["']/g,
    // dynamic import('x')
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // require('x')
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    for (const match of clean.matchAll(re)) {
      const spec = match[1];
      const idx = match.index ?? 0;
      const line = clean.slice(0, idx).split("\n").length;
      const key = `${line}:${spec}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ specifier: spec, line });
      }
    }
  }
  return results;
}

function isTestFile(relPath) {
  return (
    /(?:^|\/)(?:tests?|__tests__)\//.test(relPath) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relPath)
  );
}

function walkFiles(dir, root, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, root, out);
      continue;
    }
    if (!CODE_EXTENSIONS.has(extname(entry.name))) continue;
    const rel = relative(root, full).replaceAll("\\", "/");
    if (isTestFile(rel)) continue;
    out.push({ full, rel });
  }
}

function unitForPath(relPath) {
  if (relPath.startsWith("docs/protocol-apw/")) return "docs/protocol-apw";
  if (relPath.startsWith("packages/")) {
    const seg = relPath.split("/")[1];
    return seg || null;
  }
  const top = relPath.split("/")[0];
  if (L5_ROOTS.includes(top)) return top;
  return null;
}

function resolveTarget(root, fromFileRel, specifier) {
  // Scoped package imports: @portaless/<pkg>(/subpath) or @verared/<pkg>(/subpath)
  const scoped = specifier.match(/^@(portaless|verared)\/([a-z0-9-]+)(\/.*)?$/);
  if (scoped) {
    const pkg = scoped[2];
    const subpath = scoped[3] || "";
    const isDeepSrc = /^\/src(?:\/|$)/.test(subpath);
    return {
      targetUnit: pkg,
      targetPath: specifier,
      kind: isDeepSrc ? "deep-src" : "package-entry",
    };
  }
  if (!specifier.startsWith(".")) return null;

  const absTarget = resolve(dirname(resolve(root, fromFileRel)), specifier);
  const relTarget = relative(root, absTarget).replaceAll("\\", "/");
  if (relTarget.startsWith("..")) return null;

  const targetUnit = unitForPath(relTarget);
  if (!targetUnit) return null;

  const isDeepSrc = /^packages\/[a-z0-9-]+\/src(?:\/|$)/.test(relTarget);
  return {
    targetUnit,
    targetPath: relTarget,
    kind: isDeepSrc ? "deep-src" : "relative",
  };
}

function classifyLayerViolation(fromUnit, toUnit) {
  const fromMeta = PACKAGE_LAYERS[fromUnit];
  const toMeta = PACKAGE_LAYERS[toUnit];
  if (!fromMeta || !toMeta) return null;
  if (fromUnit === toUnit) return null;

  // Contracts must never import Portaless runtime code.
  if (fromMeta.layer === "Contracts") {
    return "contracts-to-portaless";
  }

  // Extensions may only import plugin-sdk.
  if (fromMeta.layer === "Extensions") {
    return toUnit === "plugin-sdk" ? null : "extension-to-core";
  }

  // verared packages must never import geroiloyola packages.
  if (fromMeta.org === "verared" && toMeta.org === "geroiloyola") {
    return "verared-to-geroiloyola";
  }

  // L4 (mcp-server) must never import L5 (src/functions/server/scripts).
  if (fromMeta.layer === "L4" && toMeta.layer === "L5") {
    return "l4-to-l5";
  }

  // Same-layer edges must be explicitly allowlisted (except L5->L5).
  if (fromMeta.layer === toMeta.layer) {
    if (fromMeta.layer === "L5") return null;
    const edgeKey = `${fromUnit}->${toUnit}`;
    return INTRA_LAYER_ALLOWLIST.has(edgeKey) ? null : "disallowed-intra-layer";
  }

  const allowed = ALLOWED_TARGET_LAYERS[fromMeta.layer];
  if (!allowed || !allowed.has(toMeta.layer)) {
    if (fromMeta.layer === "L1" && toMeta.layer === "L2") return "l1-to-l2";
    if (fromMeta.layer === "L2" && toMeta.layer === "L3") return "l2-to-l3";
    return "upward-layer-violation";
  }

  // L3/L4 may import plugin-sdk (Contracts), not docs/protocol-apw runtime.
  if (toUnit === "docs/protocol-apw" && fromMeta.layer !== "L5") {
    return "runtime-to-spec-tree";
  }

  return null;
}

/**
 * Finds strongly connected components of size > 1 (cycles) deterministically.
 */
export function findCycles(adjacency) {
  const nodes = [...adjacency.keys()].sort();
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = [...(adjacency.get(v) || [])].sort();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      while (true) {
        const w = stack.pop();
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) {
        cycles.push(scc.sort());
      }
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) strongConnect(node);
  }
  return cycles.sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

export function checkLicenses(root) {
  const violations = [];
  const checkPkg = (relPkgJson, expectedLicense, requireLicenseFile = false) => {
    const full = resolve(root, relPkgJson);
    if (!existsSync(full)) return;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      violations.push({ file: relPkgJson, reason: "invalid-package-json", expected: expectedLicense, actual: null });
      return;
    }
    if (parsed.license !== expectedLicense) {
      violations.push({
        file: relPkgJson,
        reason: "license-mismatch",
        expected: expectedLicense,
        actual: parsed.license ?? null,
      });
    }
    if (requireLicenseFile) {
      const licPath = resolve(dirname(full), "LICENSE");
      if (!existsSync(licPath)) {
        violations.push({
          file: relative(root, licPath).replaceAll("\\", "/"),
          reason: "missing-license-file",
          expected: expectedLicense,
          actual: null,
        });
      }
    }
  };

  checkPkg("package.json", "AGPL-3.0-or-later");
  checkPkg("docs/protocol-apw/package.json", "CC-BY-4.0");
  checkPkg("packages/plugin-sdk/package.json", "MIT");

  const packagesDir = resolve(root, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "plugin-sdk") continue;
      const meta = PACKAGE_LAYERS[entry.name];
      if (!meta) continue;
      const relPkg = `packages/${entry.name}/package.json`;
      if (meta.org === "verared") {
        checkPkg(relPkg, "Apache-2.0", true);
      } else {
        checkPkg(relPkg, "AGPL-3.0-or-later", false);
      }
    }
  }
  return violations;
}

const VERARED_MIGRATED_DIRS = [
  "net",
  "apw-resolver",
  "ltp-engine",
  "ltp-reputation",
  "trust-layer",
  "cloud-images",
  "identity-atproto",
];

const VERARED_REQUIRED_PACKAGES = [
  "@verared/net",
  "@verared/apw",
  "@verared/local-trust",
  "@verared/reputation",
  "@verared/trust-layer",
  "@verared/cloud-images",
  "@verared/identity-atproto",
];

export function checkVeraredPin(root) {
  const violations = [];
  const pinPath = resolve(root, "SPEC-PIN.json");
  if (!existsSync(pinPath)) return violations;

  let pin;
  try {
    pin = JSON.parse(readFileSync(pinPath, "utf8"));
  } catch {
    violations.push({ file: "SPEC-PIN.json", reason: "invalid-spec-pin-json" });
    return violations;
  }

  if (!/^[a-f0-9]{40}$/.test(pin.commit || "")) {
    violations.push({ file: "SPEC-PIN.json", reason: "invalid-spec-commit" });
  }
  if (!pin.tag) {
    violations.push({ file: "SPEC-PIN.json", reason: "missing-spec-tag" });
  }
  if (pin.digests?.corpusDigest !== "wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA") {
    violations.push({ file: "SPEC-PIN.json", reason: "corpus-digest-mismatch" });
  }
  if (!pin.stack?.version || !pin.stack?.tag) {
    violations.push({ file: "SPEC-PIN.json", reason: "missing-stack-version" });
  }

  for (const dir of VERARED_MIGRATED_DIRS) {
    if (existsSync(resolve(root, "packages", dir))) {
      violations.push({ file: `packages/${dir}`, reason: "duplicated-verared-package" });
    }
  }
  if (existsSync(resolve(root, "packages", "plugin-sdk"))) {
    violations.push({ file: "packages/plugin-sdk", reason: "duplicated-plugin-sdk-package" });
  }
  if (existsSync(resolve(root, "site-profiles", "demo"))) {
    violations.push({ file: "site-profiles/demo", reason: "duplicated-demo-templates" });
  }
  if (existsSync(resolve(root, "docs", "screenshots"))) {
    violations.push({ file: "docs/screenshots", reason: "forbidden-docs-screenshots" });
  }

  const localSpecDir = resolve(root, "docs/protocol-apw");
  if (existsSync(localSpecDir)) {
    for (const entry of readdirSync(localSpecDir, { withFileTypes: true })) {
      if (entry.name === "README.md" && entry.isFile()) continue;
      violations.push({ file: `docs/protocol-apw/${entry.name}`, reason: "duplicated-verared-spec" });
    }
  }

  const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const SHA512_INTEGRITY_RE = /^sha512-[A-Za-z0-9+/]+=*$/;

  const rootPkgPath = resolve(root, "package.json");
  if (existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
      const allDeps = {
        ...(rootPkg.dependencies || {}),
        ...(rootPkg.devDependencies || {}),
      };
      for (const name of VERARED_REQUIRED_PACKAGES) {
        const spec = allDeps[name];
        if (spec === undefined) continue;
        if (typeof spec !== "string" || !EXACT_SEMVER_RE.test(spec)) {
          violations.push({ file: "package.json", reason: `unpinned-verared-version:${name}` });
        } else if (pin.stack?.version && spec !== pin.stack.version) {
          violations.push({ file: "package.json", reason: `verared-stack-version-mismatch:${name}` });
        }
      }
    } catch {
      violations.push({ file: "package.json", reason: "invalid-root-package-json" });
    }
  }

  const lockPath = resolve(root, "package-lock.json");
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const pkgs = lock.packages || {};
      for (const name of VERARED_REQUIRED_PACKAGES) {
        const entry = pkgs[`node_modules/${name}`];
        const resolved = String(entry?.resolved || "");
        const integrity = String(entry?.integrity || "");
        const version = String(entry?.version || "");
        if (!entry) {
          violations.push({ file: "package-lock.json", reason: `missing-verared-lock-entry:${name}` });
        } else {
          if (!resolved.startsWith(`https://registry.npmjs.org/${name}/-/`)) {
            violations.push({ file: "package-lock.json", reason: `invalid-verared-registry-source:${name}` });
          }
          if (!EXACT_SEMVER_RE.test(version) || (pin.stack?.version && version !== pin.stack.version)) {
            violations.push({ file: "package-lock.json", reason: `invalid-verared-lock-version:${name}` });
          }
          if (!SHA512_INTEGRITY_RE.test(integrity)) {
            violations.push({ file: "package-lock.json", reason: `missing-verared-integrity:${name}` });
          }
        }
      }
      const specEntry = pkgs["node_modules/@verared/spec"];
      const specResolved = String(specEntry?.resolved || "");
      if (!specEntry) {
        violations.push({ file: "package-lock.json", reason: "missing-verared-lock-entry:@verared/spec" });
      } else if (specResolved.includes("registry.npmjs.org") || !specResolved.startsWith("https://github.com/verared/vera-trust-spec/releases/download/")) {
        violations.push({ file: "package-lock.json", reason: "invalid-verared-tarball-source:@verared/spec" });
      }
      const sdkEntry = pkgs["node_modules/@portaless/plugin-sdk"];
      const sdkResolved = String(sdkEntry?.resolved || "");
      if (!sdkEntry) {
        violations.push({ file: "package-lock.json", reason: "missing-plugin-sdk-lock-entry:@portaless/plugin-sdk" });
      } else if (sdkResolved.includes("registry.npmjs.org") || !sdkResolved.startsWith("https://github.com/geroiloyola/portaless-plugin-sdk/releases/download/")) {
        violations.push({ file: "package-lock.json", reason: "invalid-plugin-sdk-tarball-source:@portaless/plugin-sdk" });
      }
      const templatesEntry = pkgs["node_modules/@portaless/templates"];
      const templatesResolved = String(templatesEntry?.resolved || "");
      if (!templatesEntry) {
        violations.push({ file: "package-lock.json", reason: "missing-templates-lock-entry:@portaless/templates" });
      } else if (templatesResolved.includes("registry.npmjs.org") || !templatesResolved.startsWith("https://github.com/geroiloyola/portaless-templates/releases/download/")) {
        violations.push({ file: "package-lock.json", reason: "invalid-templates-tarball-source:@portaless/templates" });
      }
    } catch {
      violations.push({ file: "package-lock.json", reason: "invalid-package-lock-json" });
    }
  }

  return violations;
}

export function analyzeTree(root) {
  const files = [];
  walkFiles(resolve(root, "packages"), root, files);
  walkFiles(resolve(root, "docs/protocol-apw"), root, files);
  for (const l5 of L5_ROOTS) {
    walkFiles(resolve(root, l5), root, files);
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const edges = [];
  const packageAdjacency = new Map();

  for (const { full, rel } of files) {
    if (!statSync(full).isFile()) continue;
    const fromUnit = unitForPath(rel);
    if (!fromUnit) continue;

    const source = readFileSync(full, "utf8");
    const specs = extractSpecifiers(source);
    for (const { specifier, line } of specs) {
      const resolved = resolveTarget(root, rel, specifier);
      if (!resolved) continue;
      const { targetUnit, targetPath, kind } = resolved;
      if (targetUnit === fromUnit) continue;

      const fromMeta = PACKAGE_LAYERS[fromUnit] || { layer: "Unknown", org: "unknown" };
      const toMeta = PACKAGE_LAYERS[targetUnit] || { layer: "Unknown", org: "unknown" };
      const violation = classifyLayerViolation(fromUnit, targetUnit);

      edges.push({
        fromUnit,
        toUnit: targetUnit,
        fromLayer: fromMeta.layer,
        toLayer: toMeta.layer,
        fromOrg: fromMeta.org,
        toOrg: toMeta.org,
        file: rel,
        line,
        specifier,
        targetPath,
        kind,
        violation,
      });

      // Track cycles across packages (excluding L5->L5 composition roots).
      if (fromMeta.layer !== "L5" && toMeta.layer !== "L5") {
        if (!packageAdjacency.has(fromUnit)) packageAdjacency.set(fromUnit, new Set());
        packageAdjacency.get(fromUnit).add(targetUnit);
      }
    }
  }

  const deepSrcPackages = edges.filter(
    (e) => e.kind === "deep-src" && e.fromLayer !== "L5",
  );
  const deepSrcL5 = edges.filter(
    (e) => e.kind === "deep-src" && e.fromLayer === "L5",
  );
  const packageEntryImports = edges.filter((e) => e.kind === "package-entry");
  const cycles = findCycles(packageAdjacency);
  const layerViolations = edges.filter((e) => e.violation !== null);

  const violationsByType = {};
  for (const v of layerViolations) {
    violationsByType[v.violation] = (violationsByType[v.violation] || 0) + 1;
  }

  const veraredReverseImports = layerViolations.filter(
    (e) =>
      e.violation === "verared-to-geroiloyola" ||
      e.violation === "l1-to-l2" ||
      (e.violation === "contracts-to-portaless" && e.fromUnit === "docs/protocol-apw"),
  );

  const deepSrcAll = [...deepSrcPackages, ...deepSrcL5];
  const deepSrcVerared = deepSrcAll.filter((e) => e.toOrg === "verared").length;
  const deepSrcGeroiloyola = deepSrcAll.filter((e) => e.toOrg === "geroiloyola").length;
  const licenseViolationItems = checkLicenses(root);
  const veraredPinViolationItems = checkVeraredPin(root);

  const exportReady = {
    zeroVeraredReverseImports: veraredReverseImports.length === 0,
    zeroCycles: cycles.length === 0,
    zeroDeepSrcImports: deepSrcPackages.length + deepSrcL5.length === 0,
    zeroLayerViolations: layerViolations.length === 0,
    zeroLicenseViolations: licenseViolationItems.length === 0,
    zeroVeraredPinViolations: veraredPinViolationItems.length === 0,
    ready:
      veraredReverseImports.length === 0 &&
      cycles.length === 0 &&
      deepSrcPackages.length + deepSrcL5.length === 0 &&
      layerViolations.length === 0 &&
      licenseViolationItems.length === 0 &&
      veraredPinViolationItems.length === 0,
  };

  return {
    scannedFiles: files.length,
    totalCrossUnitImports: edges.length,
    deepSrcImports: {
      packages: deepSrcPackages.length,
      l5: deepSrcL5.length,
      total: deepSrcPackages.length + deepSrcL5.length,
      byTargetOrg: {
        verared: deepSrcVerared,
        geroiloyola: deepSrcGeroiloyola,
      },
    },
    packageEntryImports: packageEntryImports.length,
    cycles,
    layerViolations: {
      total: layerViolations.length,
      byType: violationsByType,
      veraredReverseCount: veraredReverseImports.length,
    },
    licenseViolations: {
      total: licenseViolationItems.length,
      items: licenseViolationItems,
    },
    veraredPinViolations: {
      total: veraredPinViolationItems.length,
      items: veraredPinViolationItems,
    },
    exportReady,
    details: {
      layerViolations,
      deepSrcPackages,
      deepSrcL5,
      licenseViolations: licenseViolationItems,
      veraredPinViolations: veraredPinViolationItems,
    },
  };
}

export function formatMarkdownSummary(report) {
  const ok = (b) => (b ? "PASS" : "PENDING");
  const v = report.layerViolations.byType;
  const cycleText =
    report.cycles.length === 0
      ? "0"
      : `${report.cycles.length} (${report.cycles.map((c) => c.join(" <-> ")).join("; ")})`;
  const lines = [
    "### Architecture Boundaries Gate (E-07)",
    "",
    "| Metric | Count | Status |",
    "|---|---:|---|",
    `| Deep \`packages/*/src/\` imports (packages) | ${report.deepSrcImports.packages} | ${ok(report.deepSrcImports.packages === 0)} |`,
    `| Deep \`packages/*/src/\` imports (L5: src/functions/server/scripts) | ${report.deepSrcImports.l5} | ${ok(report.deepSrcImports.l5 === 0)} |`,
    `| Deep \`packages/*/src/\` imports -> \`verared\` | ${report.deepSrcImports.byTargetOrg.verared} | ${ok(report.deepSrcImports.byTargetOrg.verared === 0)} |`,
    `| Deep \`packages/*/src/\` imports -> \`geroiloyola\` | ${report.deepSrcImports.byTargetOrg.geroiloyola} | ${ok(report.deepSrcImports.byTargetOrg.geroiloyola === 0)} |`,
    `| Public package-entry imports (\`@portaless/*\` / \`@verared/*\`) | ${report.packageEntryImports} | info |`,
    `| Package dependency cycles | ${cycleText} | ${ok(report.exportReady.zeroCycles)} |`,
    `| Layer / org violations (total) | ${report.layerViolations.total} | ${ok(report.exportReady.zeroLayerViolations)} |`,
    `| \`verared\` -> \`geroiloyola\` / L1->L2 / spec->code | ${report.layerViolations.veraredReverseCount} | ${ok(report.exportReady.zeroVeraredReverseImports)} |`,
    `| License boundary violations | ${report.licenseViolations.total} | ${ok(report.exportReady.zeroLicenseViolations)} |`,
    `| \`@verared/*\` pin & tarball boundary violations | ${report.veraredPinViolations.total} | ${ok(report.exportReady.zeroVeraredPinViolations)} |`,
    `| **Export-Ready (Wave 1 -> Wave 2)** | — | **${report.exportReady.ready ? "READY" : "NOT READY"}** |`,
    "",
  ];
  const types = Object.keys(v).sort();
  if (types.length > 0) {
    lines.push("Violation breakdown: " + types.map((k) => `\`${k}\`: ${v[k]}`).join(" · "));
    lines.push("");
  }
  return lines.join("\n");
}

export function formatTextReport(report) {
  const lines = [
    `[check-architecture-boundaries] scanned ${report.scannedFiles} non-test files`,
    `  deep packages/*/src/ imports: ${report.deepSrcImports.total} (packages: ${report.deepSrcImports.packages}, L5: ${report.deepSrcImports.l5}; target verared: ${report.deepSrcImports.byTargetOrg.verared}, geroiloyola: ${report.deepSrcImports.byTargetOrg.geroiloyola})`,
    `  public package-entry imports: ${report.packageEntryImports}`,
    `  package cycles: ${report.cycles.length}${
      report.cycles.length
        ? " -> " + report.cycles.map((c) => c.join(" <-> ")).join("; ")
        : ""
    }`,
    `  layer/org violations: ${report.layerViolations.total} (verared reverse: ${report.layerViolations.veraredReverseCount})`,
  ];
  for (const [k, count] of Object.entries(report.layerViolations.byType).sort()) {
    lines.push(`    - ${k}: ${count}`);
  }
  lines.push(`  license violations: ${report.licenseViolations.total}`);
  for (const lv of report.licenseViolations.items) {
    lines.push(`    - ${lv.file}: ${lv.reason} (expected ${lv.expected}, got ${lv.actual})`);
  }
  lines.push(`  verared pin violations: ${report.veraredPinViolations.total}`);
  for (const pv of report.veraredPinViolations.items) {
    lines.push(`    - ${pv.file}: ${pv.reason}`);
  }
  lines.push(
    `  export-ready (Wave 1 -> Wave 2): ${report.exportReady.ready ? "READY" : "NOT READY"}`,
  );
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const strict = args.has("--strict");
  const json = args.has("--json");
  const rootFlagIdx = argv.indexOf("--root");
  const root =
    rootFlagIdx !== -1 && argv[rootFlagIdx + 1]
      ? resolve(argv[rootFlagIdx + 1])
      : fileURLToPath(new URL("../", import.meta.url));
  const report = analyzeTree(root);

  if (json) {
    const { details: _details, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      formatMarkdownSummary(report) + "\n",
      "utf8",
    );
  }

  if (strict && !report.exportReady.ready) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
