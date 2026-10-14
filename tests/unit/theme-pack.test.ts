// packages/atomic-elements/src/themes/theme-pack.ts — contrato de temas por
// pagina. Cubre: paridad de la allowlist con TOKEN_TO_CSS_VAR (mismo
// patron que mcp-element-schema-parity: si dashboard agrega un token y
// este archivo no, el test falla), paridad de la mascara de valores con
// isSafeTokenValue, validacion/ resolucion (extends, ciclos, cadena rota),
// el orden estable de themeStyleDecl, el dedupe de availableThemes, la
// validacion de PageLayout.theme en validatePageLayout, y que el ejemplo
// builtin "2pac-dark" pasa WCAG AA por math (los mismos pares que un
// LinkList solido y el texto del sitio usan en la vida real).

import { describe, it, expect } from "vitest";
import {
  THEME_VARS,
  THEME_NAME_PATTERN,
  isSafeThemeValue,
  validateThemePack,
  resolveThemePack,
  themeStyleDecl,
  availableThemes,
  BUILTIN_THEMES,
  type ThemePack,
} from "../../packages/atomic-elements/src/themes/theme-pack";
import { TOKEN_TO_CSS_VAR } from "../../packages/dashboard/src/skin-engine/tokens";
import { isSafeTokenValue } from "../../packages/dashboard/src/skin-engine/site-skin-store";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

// --- helpers ---------------------------------------------------------------

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`hex invalido: ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const linear = channels.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function baseLayout(fields: Partial<PageLayout> = {}): PageLayout {
  return {
    version: "0.1",
    slug: "pagina",
    title: "Pagina",
    root: [{ id: "n1", type: "Paragraph", props: { text: "hola" } }],
    ...fields,
  };
}

const PAC = BUILTIN_THEMES.find((t) => t.name === "2pac-dark")!;

// --- paridad de allowlist y mascara ---------------------------------------

describe("allowlist THEME_VARS en paridad con TOKEN_TO_CSS_VAR", () => {
  it("las 16 variables son exactamente las que dashboard mapea a CSS", () => {
    expect([...THEME_VARS].sort()).toEqual(Object.values(TOKEN_TO_CSS_VAR).sort());
    expect(THEME_VARS).toHaveLength(16);
    expect(new Set(THEME_VARS).size).toBe(THEME_VARS.length);
  });

  it("cada variable ya es el nombre CSS (el pack no necesita mapear nada)", () => {
    for (const cssVar of THEME_VARS) expect(cssVar).toMatch(/^--[a-z0-9-]+$/);
  });
});

describe("mascara de valores en paridad con isSafeTokenValue de dashboard", () => {
  const samples = [
    "#F05D23",
    "22px",
    "comfortable",
    "var(--accent)",
    "rgb(1 2 3 / 50%)",
    "0 6px 20px rgba(0,0,0,.25)",
    "red; } body { color: red",
    "</style><script>alert(1)</script>",
    '" onload="evil()',
    "{--x:1}",
    "#F05D23;--otra:1",
    42,
    null,
    "x".repeat(41),
  ];

  it("acepta y rechaza exactamente los mismos valores que dashboard", () => {
    for (const sample of samples) {
      expect(isSafeThemeValue(sample)).toBe(isSafeTokenValue(sample));
    }
  });
});

// --- validacion ------------------------------------------------------------

describe("validateThemePack", () => {
  it("acepta el builtin 2pac-dark y devuelve forma canonica", () => {
    const result = validateThemePack(PAC);
    expect(result.valid).toBe(true);
    expect(result.pack?.name).toBe("2pac-dark");
    expect(result.pack?.vars["--bg"]).toBe("#14100C");
  });

  it("rechaza un objeto que no es un pack", () => {
    expect(validateThemePack(null).valid).toBe(false);
    expect(validateThemePack("2pac-dark").valid).toBe(false);
    expect(validateThemePack([PAC]).valid).toBe(false);
  });

  it("rechaza un name que no es slug y un displayName vacio", () => {
    expect(validateThemePack({ ...PAC, name: "Mal Nombre" }).errors.join()).toContain("slug");
    expect(validateThemePack({ ...PAC, displayName: "   " }).errors.join()).toContain("displayName");
    expect(THEME_NAME_PATTERN.test("2pac-dark")).toBe(true);
    expect(THEME_NAME_PATTERN.test("2pac_dark")).toBe(false);
  });

  it("rechaza una variable fuera de la allowlist (un typo no puede pasar en silencio)", () => {
    const result = validateThemePack({ ...PAC, vars: { "--acccent": "#FFF" } });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("--acccent");
    expect(result.errors.join()).toContain("allowlist");
  });

  it("rechaza valores inseguros/ demasiado largos", () => {
    const result = validateThemePack({ ...PAC, vars: { "--bg": "red; } body{" } });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain("--bg");
  });

  it("rechaza vars ausentes/no-objeto y extends que no es slug", () => {
    expect(validateThemePack({ ...PAC, vars: undefined }).valid).toBe(false);
    expect(validateThemePack({ ...PAC, vars: ["#FFF"] }).valid).toBe(false);
    expect(validateThemePack({ ...PAC, extends: "Otro Tema" }).valid).toBe(false);
  });

  it("el pack valido sale limpio: claves desconocidas no se propagan", () => {
    const result = validateThemePack({ ...PAC, cssLibre: "body{}", extra: 1 });
    expect(result.valid).toBe(true);
    expect(result.pack).not.toHaveProperty("cssLibre");
    expect(result.pack).not.toHaveProperty("extra");
    expect(Object.keys(result.pack!.vars).every((k) => THEME_VARS.includes(k))).toBe(true);
  });
});

// --- resolucion ------------------------------------------------------------

describe("resolveThemePack", () => {
  const base: ThemePack = { name: "base", displayName: "Base", vars: { "--bg": "#FFF", "--text": "#000" } };
  const hijo: ThemePack = { name: "hijo", displayName: "Hijo", extends: "base", vars: { "--bg": "#111" } };

  it("unknown -> null (fallback al skin del sitio)", () => {
    expect(resolveThemePack(BUILTIN_THEMES, "no-existe")).toBeNull();
    expect(resolveThemePack([], "2pac-dark")).toBeNull();
  });

  it("fusiona la cadena: padre abajo, hijo encima, y devuelve la hoja", () => {
    const resolved = resolveThemePack([base, hijo], "hijo");
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe("hijo");
    expect(resolved!.vars).toEqual({ "--bg": "#111", "--text": "#000" });
  });

  it("cadena rota (padre ausente) -> null, nunca resolucion parcial", () => {
    const roto: ThemePack = { name: "roto", displayName: "Roto", extends: "fantasma", vars: { "--bg": "#123" } };
    expect(resolveThemePack([base, roto], "roto")).toBeNull();
  });

  it("ciclo -> null sin loop infinito", () => {
    const a: ThemePack = { name: "a", displayName: "A", extends: "b", vars: {} };
    const b: ThemePack = { name: "b", displayName: "B", extends: "a", vars: {} };
    expect(resolveThemePack([a, b], "a")).toBeNull();
    expect(resolveThemePack([a, b], "b")).toBeNull();
  });

  it("un pack builtin resuelve tal cual sin extends", () => {
    const resolved = resolveThemePack(BUILTIN_THEMES, "2pac-dark");
    expect(resolved?.vars["--accent"]).toBe("#F05D23");
  });
});

describe("themeStyleDecl", () => {
  it("emite en orden estable de THEME_VARS y solo lo declarado", () => {
    const resolved = resolveThemePack(BUILTIN_THEMES, "2pac-dark")!;
    const decl = themeStyleDecl(resolved);
    const keys = decl.split(";").map((part) => part.split(":")[0]);
    expect(keys).toEqual(THEME_VARS.filter((v) => resolved.vars[v] !== undefined));
    expect(decl.startsWith("--accent:")).toBe(true);
    expect(decl).toContain("--bg:#14100C");
    expect(decl).not.toContain("--radius"); // no declarado: hereda del skin
  });

  it("pack sin vars declaradas -> '' (el emisor no emite style)", () => {
    const vacio: ThemePack = { name: "vacio", displayName: "Vacio", vars: {} };
    expect(themeStyleDecl({ name: "vacio", vars: {} })).toBe("");
    expect(vacio.vars).toEqual({});
  });
});

describe("availableThemes", () => {
  it("un instalado no puede ocultar un builtin, y los builtins van primero", () => {
    const intruso: ThemePack = { name: "2pac-dark", displayName: "Falso", vars: { "--bg": "#FFF" } };
    const otro: ThemePack = { name: "otro-tema", displayName: "Otro", vars: { "--bg": "#000" } };
    const catalog = availableThemes([intruso, otro]);
    expect(catalog.map((t) => t.name)).toEqual(["2pac-dark", "otro-tema"]);
    expect(catalog[0].displayName).toBe("2Pac Dark");
  });

  it("sin instalados devuelve exactamente los builtins", () => {
    expect(availableThemes().map((t) => t.name)).toEqual(["2pac-dark"]);
  });
});

// --- PageLayout.theme en validatePageLayout --------------------------------

describe("validatePageLayout valida el formato de theme", () => {
  it("acepta theme slug y pagina sin theme (retro-compat)", () => {
    expect(validatePageLayout(baseLayout({ theme: "2pac-dark" })).valid).toBe(true);
    expect(validatePageLayout(baseLayout()).valid).toBe(true);
    expect(validatePageLayout(baseLayout({ theme: undefined })).valid).toBe(true);
  });

  it("rechaza un theme que no es slug (pero no exige membership: eso lo hace apply_theme)", () => {
    const bad = validatePageLayout(baseLayout({ theme: "2Pac Dark" as string }));
    expect(bad.valid).toBe(false);
    expect(bad.errors.join()).toContain("theme");
    // Nombre con formato valido pero desconocido: pasa la validacion de
    // formato y cae al fallback en el render (contrato documentado).
    expect(validatePageLayout(baseLayout({ theme: "desconocido" })).valid).toBe(true);
  });
});

// --- el ejemplo builtin pasa AA por construccion --------------------------

describe("2pac-dark: pares AA verificados por math WCAG", () => {
  const V = PAC.vars;
  const pairs: Array<[string, string, string]> = [
    ["texto del sitio sobre la pagina", V["--text"], V["--bg"]],
    ["texto del sitio sobre un panel", V["--text"], V["--panel-bg"]],
    ["links (accent-text) sobre la pagina", V["--accent-text"], V["--bg"]],
    ["links (accent-text) sobre un panel", V["--accent-text"], V["--panel-bg"]],
    ["texto apagado sobre la pagina", V["--muted"], V["--bg"]],
    // LinkList solido: color hardcodeado #261C15 sobre var(--accent).
    ["texto de boton solido sobre el acento", "#261C15", V["--accent"]],
    ["chip success", V["--success-fg"], V["--success-bg"]],
    ["chip warning", V["--warning-fg"], V["--warning-bg"]],
    ["chip danger", V["--danger-fg"], V["--danger-bg"]],
  ];

  it("todos los pares de texto alcanzan 4.5:1 (AA)", () => {
    for (const [label, fg, bg] of pairs) {
      const ratio = contrast(fg, bg);
      expect(ratio, `${label}: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el builtin completo valida contra su propio contrato", () => {
    const result = validateThemePack(PAC);
    expect(result.valid).toBe(true);
    expect(themeStyleDecl(resolveThemePack(BUILTIN_THEMES, "2pac-dark")!)).toBe(
      themeStyleDecl({ name: PAC.name, vars: PAC.vars })
    );
  });
});
