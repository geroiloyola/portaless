#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_ENTRIES } from "../src/lib/docs-nav.mjs";
import { isPubliclyPublishable } from "../packages/deploy-engine/src/draft-filter.ts";
import {
  copyPublicBuildInputs,
  copyPublicDocs,
  copyPublicSourcePages,
  copyPublicSourcePosts,
  createPublicBuildEnv,
  writePublicPageLayouts,
} from "./public-build-stage.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "portaless-public-export-check-"));
const fixtureRoot = path.join(tempRoot, "private-node");
const stageRoot = path.join(tempRoot, "public-stage");
const marker = `PORTALESS_PRIVATE_FIXTURE_${process.pid}_${Date.now()}`;

function writeJson(root, relative, value) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(value));
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in built output: ${filename}`);
    return entry.isDirectory() ? collectFiles(filename) : [filename];
  });
}

try {
  copyPublicBuildInputs(ROOT, fixtureRoot);
  fs.mkdirSync(path.join(fixtureRoot, ".airchive"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, ".airchive/private.md"), marker);
  fs.mkdirSync(path.join(fixtureRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "data/portaless.db"), marker);

  const layout = (slug, status, title) => ({ version: "0.1", slug, title, status, root: [] });
  writeJson(fixtureRoot, "src/content/pages/public-source.json", layout("public-source", "published", "Public source"));
  writeJson(fixtureRoot, "src/content/pages/private-source.json", layout("private-source", "private", marker));
  writeJson(fixtureRoot, "src/content/pages/private-source.en.json", { ...layout("private-source", "published", marker), locale: "en" });
  writeJson(fixtureRoot, "src/content/pages/draft-source.json", layout("draft-source", "draft", marker));
  writeJson(fixtureRoot, "src/content/pages/db-shadow.json", layout("db-shadow", "published", marker));

  const postsDir = path.join(fixtureRoot, "src/content/posts");
  fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(path.join(postsDir, "public.md"), "---\ntitle: Public post\ndescription: public\npubDate: 2026-01-01\n---\nPublic body");
  fs.writeFileSync(path.join(postsDir, "private-draft.md"), `---\ntitle: Private\ndescription: private\npubDate: 2026-01-01\ndraft: true\n---\n${marker}`);
  fs.writeFileSync(path.join(postsDir, "private-post.md"), `---\ntitle: Private\ndescription: private\npubDate: 2026-01-01\nprivate: true\n---\n${marker}`);

  copyPublicBuildInputs(fixtureRoot, stageRoot);
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(stageRoot, "node_modules"), "dir");
  copyPublicDocs(ROOT, stageRoot, DOC_ENTRIES);
  copyPublicSourcePages(fixtureRoot, stageRoot, new Set(["db-shadow"]), isPubliclyPublishable);
  copyPublicSourcePosts(fixtureRoot, stageRoot, isPubliclyPublishable);
  writePublicPageLayouts(stageRoot, [layout("page-store-approved", "published", "Approved PageStore")], { clear: false });

  const dist = path.join(stageRoot, "dist");
  execFileSync("npm", ["run", "build"], {
    cwd: stageRoot,
    stdio: "inherit",
    env: createPublicBuildEnv({ ...process.env, PRIVATE_TEST_SENTINEL: marker, PORTALESS_BASE_PATH: "/" }, dist),
  });

  assert.ok(fs.existsSync(path.join(dist, "pages/page-store-approved/index.html")));
  assert.ok(fs.existsSync(path.join(dist, "pages/public-source/index.html")));
  for (const filename of collectFiles(dist)) {
    assert.equal(fs.readFileSync(filename).includes(Buffer.from(marker)), false, `private marker leaked in ${path.relative(dist, filename)}`);
  }
  execFileSync("node", [path.join(ROOT, "scripts/verify-private-artifacts.mjs"), dist, "--marker", marker, "--skip-node-modules"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("Public export regression passed: synthetic private page/post/archive/DB/env markers are absent from every dist artifact.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
