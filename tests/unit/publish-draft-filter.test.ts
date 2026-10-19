// C06: una sola politica fail-closed para todas las proyecciones publicas.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  excludeDrafts,
  excludeDraftPages,
  isDraft,
  isPubliclyPublishable,
  publicationExclusionReason,
} from "../../packages/deploy-engine/src/draft-filter";

describe("publication policy", () => {
  it("mantiene published/legacy-sin-status y excluye draft/private/legacy draft", () => {
    expect(isPubliclyPublishable({ slug: "legacy" })).toBe(true);
    expect(isPubliclyPublishable({ slug: "publica", status: "published" })).toBe(true);
    expect(isPubliclyPublishable({ slug: "draft", status: "draft" })).toBe(false);
    expect(isPubliclyPublishable({ slug: "privada", status: "private" })).toBe(false);
    expect(isPubliclyPublishable({ slug: "privada", visibility: "private" })).toBe(false);
    expect(isPubliclyPublishable({ slug: "future-draft" })).toBe(false);
  });

  it("estado desconocido y slug vacio fallan cerrado", () => {
    expect(publicationExclusionReason({ slug: "x", status: "scheduled" })).toBe("invalid_status");
    expect(isPubliclyPublishable({ slug: "" })).toBe(false);
  });

  it("excludeDrafts ya no tiene bypass includeDrafts", () => {
    expect(excludeDrafts(["index", "story-draft", "draft-notes", "private" ])).toEqual({
      slugs: ["index", "draft-notes", "private"],
      skipped: 1,
    });
  });

  it("filtra PageLayout draft, private, legacy y estado desconocido", () => {
    const pages = [
      { slug: "index", status: "published" },
      { slug: "legacy-published" },
      { slug: "draft", status: "draft" },
      { slug: "private", status: "private" },
      { slug: "legacy-draft" },
      { slug: "future", status: "scheduled" },
    ];
    expect(excludeDraftPages(pages)).toEqual({
      pages: [pages[0], pages[1]],
      skipped: 4,
    });
  });

  it("isDraft conserva significado estrecho (draft/legacy), privado no es borrador", () => {
    expect(isDraft({ slug: "x", status: "draft" })).toBe(true);
    expect(isDraft({ slug: "x-draft" })).toBe(true);
    expect(isDraft({ slug: "x", status: "private" })).toBe(false);
  });

  it("las superficies publicas conocidas consumen la politica central", () => {
    const root = join(__dirname, "../..");
    const policyConsumers = [
      ["src/pages/pages/[slug].astro", "loadContentPages"],
      ["src/pages/[locale]/pages/[slug].astro", "loadContentPages"],
      ["src/pages/paginas/[slug].astro", "isPubliclyPublishable"],
      ["src/pages/[locale]/paginas/[slug].astro", "isPubliclyPublishable"],
      ["src/pages/sitemap.xml.ts", "loadContentPages"],
      ["src/pages/llms.txt.ts", "isPubliclyPublishable"],
      ["src/pages/rss.xml.ts", "publishedPosts"],
      ["src/pages/blog/index.astro", "publishedPosts"],
      ["src/pages/blog/[...slug].astro", "isPubliclyPublishable"],
      ["src/pages/blog/[...slug].md.ts", "publishedPosts"],
      ["src/components/ExplorePage.astro", "isPubliclyPublishable"],
      ["functions/pages/[slug].js", "isPubliclyPublishable"],
      ["functions/llms.txt.js", "isPubliclyPublishable"],
      ["scripts/publish-site.mjs", "excludeDraftPages"],
    ] as const;
    for (const [path, marker] of policyConsumers) {
      expect(readFileSync(join(root, path), "utf8"), path).toContain(marker);
    }
  });
});
