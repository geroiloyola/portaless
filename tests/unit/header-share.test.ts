// Boton "Compartir" del sitio: UN solo share, en el rincon del header
// (al lado de Portaless/Publicaciones). Antes de Atomic Icons Responsive
// el boton vivia ademas anclado en el ProfileHeader de cada bio y
// quedaba el doble share (header + tarjeta); el header es el unico
// dueno ahora y este test es el guardia de esa regla.
//
// Contrato en DOS lados que si se rompe deja de funcionar en silencio:
// el HTML emite [data-portaless-share] y BaseLayout + el shell runtime
// traen el listener delegado que lo atiende (Web Share API, o copiar la
// URL al portapapeles con toast como fallback). Sin handlers inline
// (onclick) ni <script> en el HTML de los elementos: compatible con una
// CSP futura.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { elementRegistry } from "../../packages/atomic-elements/src/elements/registry";
import { headerActionsHtml } from "../../src/lib/atomic-responsive-icons";

const root = join(__dirname, "../..");
const baseLayoutSrc = readFileSync(join(root, "src/layouts/BaseLayout.astro"), "utf8");
const shellSrc = readFileSync(join(root, "functions/pages/[slug].js"), "utf8");

const profileHtml = elementRegistry.ProfileHeader.renderHTML({
  avatarUrl: "/avatars/jerry-bantz.svg",
  name: "Jerry Bantz",
  bio: "Música nueva todas las semanas.",
  bgColor: "#261C15",
});

describe("share del sitio -- un solo dueño: el rincon del header", () => {
  it("el rincon del header emite el atributo que dispara el listener", () => {
    expect(headerActionsHtml(null)).toContain("data-portaless-share");
    expect(headerActionsHtml("shop")).toContain("data-portaless-share");
    expect(headerActionsHtml("video")).toContain("data-portaless-share");
  });

  it("es accesible: tipo button, etiqueta y titulo", () => {
    const html = headerActionsHtml(null);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Compartir este enlace"');
    expect(html).toContain('title="Compartir este enlace"');
  });

  it("el ProfileHeader NO trae boton share (nunca doble share)", () => {
    expect(profileHtml).not.toContain("data-portaless-share");
    expect(profileHtml).not.toContain("ae-share");
    expect(profileHtml).not.toContain("top:12px;right:12px");
  });

  it("el HTML del rincon sale sin handlers inline ni scripts (compatible con CSP)", () => {
    const html = headerActionsHtml(null);
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
  });

  it("BaseLayout trae el listener delegado que lo atiende", () => {
    expect(baseLayoutSrc).toContain("[data-portaless-share]");
    expect(baseLayoutSrc).toContain("navigator.share");
    expect(baseLayoutSrc).toContain("navigator.clipboard.writeText");
  });

  it("el shell runtime (paginas servidas desde la base) trae el mismo listener", () => {
    expect(shellSrc).toContain("[data-portaless-share]");
    expect(shellSrc).toContain("navigator.share");
    expect(shellSrc).toContain("navigator.clipboard.writeText");
    expect(shellSrc).not.toContain("onclick");
  });
});
