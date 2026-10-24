import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ["node_modules", ".venv", "__pycache__"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return path.endsWith(".md") ? [path] : [];
  });
}

function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/ /g, "-")
    .replace(/^-|-$/g, "");
}

function anchors(file: string): Set<string> {
  const text = stripFencedCode(readFileSync(file, "utf8"));
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) out.add(slug(match[1]));
  }
  for (const match of text.matchAll(/<a\s+[^>]*name=["']([^"']+)["']/gi)) out.add(match[1]);
  for (const match of text.matchAll(/<a\s+[^>]*id=["']([^"']+)["']/gi)) out.add(match[1]);
  return out;
}

function markdownFiles(): string[] {
  const docs = walk(join(root, "docs"));
  const readmes = readdirSync(root)
    .filter((name) => /^README.*\.md$/i.test(name))
    .map((name) => join(root, name));
  return [...docs, ...readmes];
}

describe("local Markdown links and anchors", () => {
  it("checks project docs but excludes installed third-party docs in a standalone asset package", () => {
    const temp = mkdtempSync(join(tmpdir(), "markdown-boundary-"));
    try {
      mkdirSync(join(temp, "spec/node_modules/vendor"), { recursive: true });
      writeFileSync(join(temp, "spec/README.md"), "[project](./contract.md)");
      writeFileSync(join(temp, "spec/contract.md"), "# Contract");
      writeFileSync(join(temp, "spec/node_modules/vendor/README.md"), "[upstream](./not-in-tarball.md)");
      expect(walk(temp).map(path => relative(temp, path)).sort()).toEqual(["spec/README.md", "spec/contract.md"]);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("README*.md and docs/** have no broken relative target or anchor", () => {
    const problems: string[] = [];
    for (const file of markdownFiles()) {
      const text = stripFencedCode(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const raw = match[1].trim();
        if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) continue;
        if (raw.startsWith("/") && !raw.startsWith("/docs/")) continue;
        const [pathPart, anchorPart] = raw.split("#");
        const target = pathPart ? resolve(dirname(file), pathPart) : file;
        if (!existsSync(target)) {
          problems.push(`${relative(root, file)} -> ${raw} (missing target)`);
          continue;
        }
        if (anchorPart && (target.endsWith(".md") || target === file)) {
          const known = anchors(target);
          const decoded = decodeURIComponent(anchorPart).toLowerCase();
          if (!known.has(anchorPart.toLowerCase()) && !known.has(decoded)) {
            problems.push(`${relative(root, file)} -> ${raw} (missing anchor)`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
