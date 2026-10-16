// Tema oscuro del ecosistema Portaless (default de la guia de diseno,
// docs/design/home-redesign.md). El home lo declara en su propio PageLayout
// (theme: "portaless-nocturno"); las paginas que NO son PageLayout (el indice
// del blog, cada post, Explore) lo aplican por esta via: resuelven el pack
// builtin y lo pasan como pageTheme a BaseLayout. El admin puede cambiarlo por
// pagina (es un theme pack, no un color fijo).
import {
  BUILTIN_THEMES,
  resolveThemePack,
  themeStyleDecl,
} from "../../packages/atomic-elements/src/themes/theme-pack";

export const ECOSYSTEM_THEME = "portaless-nocturno";

export function ecosystemPageTheme(): { name: string; css: string } | undefined {
  const resolved = resolveThemePack(BUILTIN_THEMES, ECOSYSTEM_THEME);
  return resolved ? { name: resolved.name, css: themeStyleDecl(resolved) } : undefined;
}
