#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_ENTRIES } from "../src/lib/docs-nav.mjs";
import { isPubliclyPublishable } from "@portaless/deploy-engine/draft-filter";
import { SqlitePageStore } from "@portaless/atomic-elements/sqlite-page-store";
import { writePublicRevisionHistories } from "./public-revision-export.mjs";
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

async function runProfileExportCheck(profile) {
  const fixtureRoot = path.join(tempRoot, `private-node-${profile}`);
  const stageRoot = path.join(tempRoot, `public-stage-${profile}`);

  copyPublicBuildInputs(ROOT, fixtureRoot, { profile });
  fs.mkdirSync(path.join(fixtureRoot, ".airchive"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, ".airchive/private.md"), marker);
  fs.mkdirSync(path.join(fixtureRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "data/portaless.db"), marker);

  const layout = (slug, status, title) => ({ version: "0.1", slug, title, status, root: [] });
  const stageProfileRel = profile === "demo" ? ".portaless-stage/demo" : "site-profiles/starter";
  const pagesRel = `${stageProfileRel}/pages`;
  const postsRel = `${stageProfileRel}/posts`;
  writeJson(fixtureRoot, `${pagesRel}/public-source.json`, layout("public-source", "published", "Public source"));
  writeJson(fixtureRoot, `${pagesRel}/private-source.json`, layout("private-source", "private", marker));
  writeJson(fixtureRoot, `${pagesRel}/private-source.en.json`, { ...layout("private-source", "published", marker), locale: "en" });
  writeJson(fixtureRoot, `${pagesRel}/draft-source.json`, layout("draft-source", "draft", marker));
  writeJson(fixtureRoot, `${pagesRel}/db-shadow.json`, layout("db-shadow", "published", marker));
  writeJson(fixtureRoot, "src/content/revision-history/private.json", { title: marker });
  writeJson(fixtureRoot, "public/revisions/private/index.json", { title: marker });

  const postsDir = path.join(fixtureRoot, postsRel);
  fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(path.join(postsDir, "public.md"), "---\ntitle: Public post\ndescription: public\npubDate: 2026-01-01\n---\nPublic body");
  fs.writeFileSync(path.join(postsDir, "private-draft.md"), `---\ntitle: Private\ndescription: private\npubDate: 2026-01-01\ndraft: true\n---\n${marker}`);
  fs.writeFileSync(path.join(postsDir, "private-post.md"), `---\ntitle: Private\ndescription: private\npubDate: 2026-01-01\nprivate: true\n---\n${marker}`);

  copyPublicBuildInputs(fixtureRoot, stageRoot, { profile });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(stageRoot, "node_modules"), "dir");
  if (profile === "demo") {
    copyPublicDocs(ROOT, stageRoot, DOC_ENTRIES);
  }
  copyPublicSourcePages(fixtureRoot, stageRoot, new Set(["db-shadow"]), isPubliclyPublishable, { profile });
  copyPublicSourcePosts(fixtureRoot, stageRoot, isPubliclyPublishable, { profile });

  const store = await SqlitePageStore.open(path.join(tempRoot, `canonical-${profile}.sqlite`));
  let approved;
  try {
    await store.save(layout("page-store-approved", "draft", marker));
    const draft = await store.load("page-store-approved");
    await store.save({ ...draft, status: "published", title: "Approved PageStore" });
    approved = await store.load("page-store-approved");
    writePublicPageLayouts(stageRoot, [approved], { clear: false, profile });
    await writePublicRevisionHistories(stageRoot, [approved], store);
  } finally {
    store.close();
  }

  const dist = path.join(stageRoot, "dist");
  execFileSync("npm", ["run", "build"], {
    cwd: stageRoot,
    stdio: "inherit",
    env: createPublicBuildEnv(
      {
        ...process.env,
        PRIVATE_TEST_SENTINEL: marker,
        PORTALESS_BASE_PATH: "/",
        PORTALESS_SITE_PROFILE: profile,
        ...(profile === "demo" ? { PORTALESS_STAGE_PROFILE_DIR: stageProfileRel } : {}),
      },
      dist,
    ),
  });

  assert.ok(fs.existsSync(path.join(dist, "pages/page-store-approved/index.html")));
  assert.ok(fs.existsSync(path.join(dist, "pages/public-source/index.html")));
  if (profile === "demo") {
    assert.ok(fs.existsSync(path.join(dist, "docs/first-steps/index.html")), "demo projection must retain public Docs routes");
  } else {
    assert.equal(fs.existsSync(path.join(dist, "docs")), false, "starter projection must not emit docs/");
    assert.equal(fs.existsSync(path.join(dist, "es")), false, "starter projection must not emit es/");
    assert.equal(fs.existsSync(path.join(dist, "beta")), false, "starter projection must not emit beta/");
  }

  const history = JSON.parse(fs.readFileSync(path.join(dist, "revisions", approved.publicationId, "index.json"), "utf8"));
  assert.equal(history.revisions.length, 1);
  assert.equal(history.revisions[0].revisionId, approved.revisionId);
  assert.ok(fs.readFileSync(path.join(dist, "pages/page-store-approved/index.html"), "utf8").includes("Historial público"));
  for (const filename of collectFiles(dist)) {
    assert.equal(fs.readFileSync(filename).includes(Buffer.from(marker)), false, `private marker leaked in ${path.relative(dist, filename)}`);
  }
  execFileSync("node", [path.join(ROOT, "scripts/verify-private-artifacts.mjs"), dist, "--marker", marker, "--skip-node-modules"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

try {
  await runProfileExportCheck("starter");
  await runProfileExportCheck("demo");
  console.log("Public export regression passed for both starter and demo profiles: synthetic private markers are absent from every dist artifact.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
