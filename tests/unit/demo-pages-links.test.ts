// Páginas de ejemplo: sin enlaces muertos ni de relleno (Fase 12, §3).
// Un visitante que hace clic y llega a la nada concluye que el producto está
// roto. Este test recorre los JSON de ejemplo, extrae cada `url` y `imageUrl`,
// y falla ante example.com, portaless.com, una raíz pelada de una plataforma
// (instagram.com/, youtube.com/, open.spotify.com/, music.apple.com/,
// bandcamp.com/, tiktok.com/@) o un http:// sin TLS. Es puro, sin red, y corre
// en CI: impide que un enlace de relleno vuelva a entrar sin que nada lo note.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..", "..", "src", "content", "pages");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

function collectLinks(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const c of node) collectLinks(c, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === "url" || k === "imageUrl") && typeof v === "string") out.push(v);
      else collectLinks(v, out);
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

describe("páginas de ejemplo: sin enlaces muertos", () => {
  for (const file of files) {
    it(`${file} no tiene enlaces muertos ni de relleno`, () => {
      const links: string[] = [];
      collectLinks(JSON.parse(readFileSync(join(dir, file), "utf8")), links);

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
