import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  copyPublicBuildInputs,
  copyPublicDocs,
  copyPublicSourcePages,
  copyPublicSourcePosts,
  createPublicBuildEnv,
  isExcludedFromPublicBuild,
  writePublicPageLayouts,
} from "../../scripts/public-build-stage.mjs";

const roots: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portaless-public-build-test-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("public build stage", () => {
  it("forwards public build settings but drops arbitrary credentials/secrets", () => {
    expect(createPublicBuildEnv({
      PATH: "/usr/bin",
      PORTALESS_BASE_PATH: "/site/",
      PUBLIC_ANALYTICS_ID: "public-id",
      PORTALESS_SQLITE_PATH: "/private/node.db",
      PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: "secret-key",
      PORTALESS_EMAIL_SMTP_PASSWORD: "secret-password",
      RANDOM_SECRET: "never-forward",
    }, "/tmp/dist")).toEqual({
      PATH: "/usr/bin",
      PORTALESS_BASE_PATH: "/site/",
      PUBLIC_ANALYTICS_ID: "public-id",
      PORTALESS_OUT_DIR: "/tmp/dist",
    });
  });

  it("omits private/runtime paths at every depth", () => {
    for (const pathName of [
      ".airchive/secret.md",
      "workspace/.airchive/secret.md",
      "data/portaless.db",
      "workspace/backups/portaless.sqlite",
      "config/.env.production",
      "config.json",
      "workspace/.ssh/id_ed25519",
      "credentials.json",
      "src/content/pages/old-page.json",
      "src/content/revision-history/unapproved.json",
      "public/revisions/unapproved/index.json",
      "packages/example/private.key",
    ]) {
      expect(isExcludedFromPublicBuild(pathName), pathName).toBe(true);
    }
    expect(isExcludedFromPublicBuild("src/pages/index.astro")).toBe(false);
    expect(isExcludedFromPublicBuild("src/pages/docs/[...slug].astro")).toBe(false);
  });

  it("copies a clean project subset and replaces page fixtures with approved layouts", () => {
    const project = tempDir();
    const stage = path.join(tempDir(), "stage");
    fs.mkdirSync(path.join(project, ".airchive"), { recursive: true });
    fs.mkdirSync(path.join(project, "src/content/pages"), { recursive: true });
    fs.mkdirSync(path.join(project, "src/pages"), { recursive: true });
    fs.mkdirSync(path.join(project, "packages"), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "astro.config.mjs"]) {
      fs.writeFileSync(path.join(project, file), "{}\n");
    }
    fs.writeFileSync(path.join(project, "README.md"), "not a build input");
    fs.mkdirSync(path.join(project, "functions"), { recursive: true });
    fs.writeFileSync(path.join(project, "functions/private.js"), "private function source");
    fs.writeFileSync(path.join(project, ".airchive/marker.txt"), "private-marker");
    fs.writeFileSync(path.join(project, "src/content/pages/stale.json"), "stale-private-page");
    fs.writeFileSync(path.join(project, "src/pages/index.astro"), "public source");

    copyPublicBuildInputs(project, stage);
    writePublicPageLayouts(stage, [{ slug: "approved", status: "published" }]);

    expect(fs.existsSync(path.join(stage, ".airchive/marker.txt"))).toBe(false);
    expect(fs.existsSync(path.join(stage, "src/content/pages/stale.json"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(stage, "src/content/pages/approved.json"), "utf8"))).toEqual({
      slug: "approved",
      status: "published",
    });
    expect(fs.readFileSync(path.join(stage, "src/pages/index.astro"), "utf8")).toBe("public source");
    expect(fs.existsSync(path.join(stage, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(stage, "functions/private.js"))).toBe(false);
  });

  it("keeps published source pages/translations but drops private or DB-shadowed slugs", () => {
    const project = tempDir();
    const stage = tempDir();
    const sourcePages = path.join(project, "src/content/pages");
    fs.mkdirSync(sourcePages, { recursive: true });
    fs.mkdirSync(path.join(stage, "src/content/pages"), { recursive: true });
    const write = (name: string, value: unknown) => fs.writeFileSync(path.join(sourcePages, name), JSON.stringify(value));
    write("public.json", { slug: "public", status: "published" });
    write("public.es.json", { slug: "public", status: "published", locale: "es" });
    write("private.json", { slug: "private", status: "private" });
    write("private.en.json", { slug: "private", status: "published", locale: "en" });
    write("db-owned.json", { slug: "db-owned", status: "published", title: "old source" });

    copyPublicSourcePages(project, stage, new Set(["db-owned"]), (layout) => layout.status === "published");
    writePublicPageLayouts(stage, [{ slug: "db-owned", status: "published", title: "PageStore" }], { clear: false });

    const target = path.join(stage, "src/content/pages");
    expect(fs.readdirSync(target).sort()).toEqual(["db-owned.json", "public.es.json", "public.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(target, "db-owned.json"), "utf8")).title).toBe("PageStore");
  });

  it("copies only publishable Markdown posts and docs explicitly listed in docs-nav", () => {
    const project = tempDir();
    const stage = tempDir();
    const posts = path.join(project, "src/content/posts");
    fs.mkdirSync(posts, { recursive: true });
    fs.mkdirSync(path.join(project, "docs/internal"), { recursive: true });
    fs.writeFileSync(path.join(posts, "public.md"), "---\ntitle: Public\npubDate: 2026-01-01\n---\nPUBLIC_MARKER");
    fs.writeFileSync(path.join(posts, "draft.md"), "---\ntitle: Draft\npubDate: 2026-01-01\ndraft: true\n---\nPRIVATE_DRAFT_MARKER");
    fs.writeFileSync(path.join(posts, "private.md"), "---\ntitle: Private\npubDate: 2026-01-01\nprivate: true\n---\nPRIVATE_POST_MARKER");
    fs.writeFileSync(path.join(project, "docs/public.md"), "PUBLIC_DOC");
    fs.writeFileSync(path.join(project, "docs/internal/secret.md"), "PRIVATE_DOC_MARKER");

    copyPublicSourcePosts(project, stage, (page) => !page.draft && page.visibility !== "private");
    copyPublicDocs(project, stage, [{ file: "docs/public.md" }]);

    const stagedPosts = path.join(stage, "src/content/posts");
    expect(fs.readdirSync(stagedPosts)).toEqual(["public.md"]);
    expect(fs.readFileSync(path.join(stagedPosts, "public.md"), "utf8")).toContain("PUBLIC_MARKER");
    expect(fs.existsSync(path.join(stage, "docs/public.md"))).toBe(true);
    expect(fs.existsSync(path.join(stage, "docs/internal/secret.md"))).toBe(false);
  });

  it("rejects page slugs that escape the staged content directory", () => {
    const stage = tempDir();
    expect(() => writePublicPageLayouts(stage, [{ slug: "../private" }])).toThrow(/fuera del directorio/);
  });

});
