import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("M-11 Cloudflare Pages compatibility", () => {
  it("does not import node:fs/node:url at the top level of the dynamic page Function", () => {
    const source = readFileSync(join(process.cwd(), "functions/pages/[slug].js"), "utf8");
    expect(source).not.toMatch(/^import\s+[^;]*from\s+["']node:(fs|url)["'];?/m);
    expect(source).toContain('import("node:fs")');
    expect(source).toContain('import("node:url")');
  });

  it("declares nodejs_compat in wrangler.toml", () => {
    const wrangler = readFileSync(join(process.cwd(), "wrangler.toml"), "utf8");
    expect(wrangler).toMatch(/compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"[^\]]*\]/);
  });
});
