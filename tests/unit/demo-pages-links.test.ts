// Páginas de ejemplo del perfil demo: sin enlaces muertos, cuentas personales
// ni medios externos sin licencia verificable (PR-B1 §3 / W3.3).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..", "..", "node_modules", "@portaless", "templates", "demo", "pages");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

function collectLinks(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const c of node) collectLinks(c, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === "url" || k === "imageUrl" || k === "avatarUrl" || k === "action") && typeof v === "string" && v.trim()) {
        out.push(v);
      } else if (k === "images" && typeof v === "string") {
        for (const line of v.split(/\r?\n/)) {
          if (line.trim()) out.push(line.trim());
        }
      } else {
        collectLinks(v, out);
      }
    }
  }
}

const BARE_ROOT_HOSTS = new Set([
  "instagram.com", "www.instagram.com",
  "youtube.com", "www.youtube.com",
  "open.spotify.com", "spotify.com",
  "music.apple.com",
  "bandcamp.com",
  "tiktok.com", "www.tiktok.com",
]);

const FORBIDDEN_DEMO_HOSTS = new Set([
  "images.unsplash.com",
  "unsplash.com",
  "placehold.co",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "formspree.io",
  "www.amazon.com",
  "amazon.com",
]);

describe("páginas de ejemplo (perfil demo): sin enlaces muertos ni activos externos sin licencia", () => {
  for (const file of files) {
    it(`${file} no tiene enlaces muertos, datos personales ni medios externos sin licencia`, () => {
      const rawText = readFileSync(join(dir, file), "utf8");
      expect(rawText.toLowerCase()).not.toContain("jerry-bantz");
      expect(rawText.toLowerCase()).not.toContain("jerrybantz");

      const links: string[] = [];
      collectLinks(JSON.parse(rawText), links);

      const problems: string[] = [];
      for (const raw of links) {
        const v = raw.trim();
        if (v.startsWith("#") || v.startsWith("/")) continue; // internos/ancla: resuelven en el sitio
        if (/^mailto:/i.test(v)) {
          if (/example\.com/i.test(v)) problems.push(`mailto con example.com: ${v}`);
          continue;
        }
        let u: URL;
        try {
          u = new URL(v);
        } catch {
          problems.push(`no es una URL: ${v}`);
          continue;
        }
        if (u.protocol !== "https:") problems.push(`sin TLS: ${v}`);
        if (u.hostname === "example.com" || u.hostname.endsWith(".example.com")) problems.push(`example.com: ${v}`);
        if (u.hostname === "portaless.com" || u.hostname.endsWith(".portaless.com")) problems.push(`portaless.com: ${v}`);
        if (FORBIDDEN_DEMO_HOSTS.has(u.hostname)) problems.push(`host externo no permitido en demo: ${v}`);
        if (BARE_ROOT_HOSTS.has(u.hostname) && (u.pathname === "" || u.pathname === "/" || u.pathname === "/@")) {
          problems.push(`raíz pelada (sin destino concreto): ${v}`);
        }
      }

      expect(problems, `${file}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }

  it("hay al menos una página de ejemplo (el test no pasa por vacío)", () => {
    expect(files.length).toBeGreaterThan(0);
  });
});
