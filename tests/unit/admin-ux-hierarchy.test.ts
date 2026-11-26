import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("PR A — /admin UX hierarchy, wizard rescue & publish clarity", () => {
  it("/admin/index.astro exposes direct links to /admin/wizard, /admin/security and /admin/settlement", () => {
    const html = read("src/pages/admin/index.astro");
    expect(html).toContain('href="/admin/wizard"');
    expect(html).toContain('href="/admin/security"');
    expect(html).toContain('href="/admin/settlement"');
    expect(html).toContain("AdminLogoutButton");
  });

  it("/admin/index.astro collapses advanced protocol tools inside native <details> by default", () => {
    const html = read("src/pages/admin/index.astro");
    const detailsStart = html.indexOf('<details class="ai-advanced" id="ai-advanced-section">');
    const detailsEnd = html.indexOf("</details>", detailsStart);
    expect(detailsStart).toBeGreaterThan(-1);
    expect(detailsEnd).toBeGreaterThan(detailsStart);

    const detailsBlock = html.slice(detailsStart, detailsEnd);
    expect(detailsBlock).not.toMatch(/<details[^>]*\bopen\b/);
    expect(detailsBlock).toContain('id="ai-apw-checklist"');
    expect(detailsBlock).toContain('id="ai-risk-summary"');
    expect(detailsBlock).toContain('href="/admin/witness-index"');
    expect(detailsBlock).toContain('href="/admin/trust-svri"');
    expect(detailsBlock).toContain('href="/admin/authorized-escrow-providers"');

    // Primary site tools remain outside (before) the collapsed advanced section.
    const beforeDetails = html.slice(0, detailsStart);
    expect(beforeDetails).toContain('href="/admin/wizard"');
    expect(beforeDetails).toContain('href="/admin/editor"');
    expect(beforeDetails).toContain('href="/admin/pages"');
    expect(beforeDetails).toContain('href="/admin/appearance"');
    expect(beforeDetails).toContain('href="/admin/publish"');
    expect(beforeDetails).toContain('href="/admin/security"');
  });

  it("wizard progress indicators are sequential 1..4 of 4 and step-2 has no broken /docs/DEPLOY_GITHUB_PAGES.md link", () => {
    expect(read("src/pages/admin/wizard/step-1-intent.astro")).toContain("Paso 1 de 4");
    const step2 = read("src/pages/admin/wizard/step-2-infrastructure.astro");
    expect(step2).toContain("Paso 2 de 4");
    expect(step2).not.toContain('href="/docs/DEPLOY_GITHUB_PAGES.md"');
    expect(step2).toContain("https://github.com/geroiloyola/portaless/blob/main/docs/DEPLOY_GITHUB_PAGES.md");
    expect(step2).toContain('href="/admin/wizard/step-4-backup-key"');
    expect(read("src/pages/admin/wizard/step-4-backup-key.astro")).toContain("Paso 3 de 4");
    expect(read("src/pages/admin/wizard/step-5-admin-credentials.astro")).toContain("Paso 4 de 4");
  });

  it("editor.astro and publish.astro clearly distinguish instant node publish from optional GitHub Pages export", () => {
    const editor = read("src/pages/admin/editor.astro");
    expect(editor).toContain("/pages/&lt;slug&gt;");
    expect(editor).toContain('href="/admin/publish"');

    const publish = read("src/pages/admin/publish.astro");
    expect(publish).toContain("GitHub Pages");
    expect(publish).toContain('href="/admin/editor"');
  });

  it("admin/index.astro, admin/pages.astro and admin/editor.astro expose the editable home (/) flow", () => {
    expect(read("src/pages/admin/index.astro")).toContain('href="/admin/editor?slug=home"');
    const pages = read("src/pages/admin/pages.astro");
    expect(pages).toContain('href="/admin/editor?slug=home"');
    expect(pages).toContain('page.slug === "home"');
    const editor = read("src/pages/admin/editor.astro");
    expect(editor).toContain("defaultHomeLayout");
    expect(editor).toContain('slug === "home"');
  });

  it("admin/publish.astro handles buildRuntimeAvailable === false with a preventive notice", () => {
    const publish = read("src/pages/admin/publish.astro");
    expect(publish).toContain('id="publish-runtime-notice"');
    expect(publish).toContain("buildRuntimeAvailable");
    expect(publish).toContain("publishBtn.disabled = !buildRuntimeAvailable");
  });
});
