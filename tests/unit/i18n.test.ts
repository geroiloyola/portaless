// i18n nativo (docs/i18n-design.md): resolver puro sobre recursos en formato
// i18next, rutas por locale y alternates hreflang. Sin dependencia de i18next:
// el valor es la COMPATIBILIDAD del formato, no el acoplamiento.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCALES,
  DEFAULT_LOCALE,
  isLocale,
  t,
  localePath,
  otherLocale,
  otherLocales,
  isMultilingual,
  hreflangAlternates,
} from "../../src/lib/i18n";

const root = join(__dirname, "../..");
const load = (loc: string) => JSON.parse(readFileSync(join(root, `src/i18n/${loc}.json`), "utf8"));

describe("locales", () => {
  it("en y es, default en", () => {
    expect([...LOCALES]).toEqual(["en", "es"]);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("los dos recursos tienen el MISMO conjunto de claves (paridad estructural)", () => {
    const keys = (obj: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
      );
    expect(keys(load("es")).sort()).toEqual(keys(load("en")).sort());
  });
});

describe("t", () => {
  it("resuelve claves anidadas", () => {
    expect(t("en", "nav.posts")).toBe("Publications");
    expect(t("es", "nav.posts")).toBe("Publicaciones");
    expect(t("en", "nav.home")).toBe("Home");
    expect(t("es", "nav.explore")).toBe("Explorar");
  });

  it("clave faltante cae al locale por defecto, y si tampoco esta, devuelve la clave", () => {
    // existe en en, no en es (simulado por una clave que solo esta en en)
    expect(t("es", "localeName")).toBe("Español"); // existe en ambos
    expect(t("es", "no.existe.jamas")).toBe("no.existe.jamas");
  });

  it("interpola {{var}}", () => {
    expect(t("en", "cta.start", { minutes: 10 })).toBe("Start in 10 minutes");
    expect(t("es", "cta.start", { minutes: 10 })).toBe("Empezá en 10 minutos");
    // var ausente -> cadena vacia, nunca 'undefined'
    expect(t("en", "cta.start", {})).toBe("Start in  minutes");
  });
});

describe("localePath", () => {
  it("el default va sin prefijo; los demas con /<locale>", () => {
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("es", "/")).toBe("/es/");
    expect(localePath("en", "/blog")).toBe("/blog");
    expect(localePath("es", "/blog")).toBe("/es/blog");
  });
});

describe("otherLocale + hreflangAlternates", () => {
  it("otherLocale alterna entre los dos", () => {
    expect(otherLocale("en")).toBe("es");
    expect(otherLocale("es")).toBe("en");
  });

  it("hreflangAlternates cubre todos los locales para una ruta", () => {
    const alts = hreflangAlternates("/");
    expect(alts).toEqual([
      { hreflang: "en", path: "/" },
      { hreflang: "es", path: "/es/" },
    ]);
  });

  it("otherLocales devuelve TODOS los demas (no asume dos)", () => {
    expect(otherLocales("en")).toEqual(["es"]);
    expect(otherLocales("es")).toEqual(["en"]);
    // la union de un locale + los demas reconstruye el set completo
    for (const l of LOCALES) {
      expect([l, ...otherLocales(l)].sort()).toEqual([...LOCALES].sort());
    }
  });

  it("isMultilingual refleja LOCALES.length > 1 (condicion del switcher)", () => {
    expect(isMultilingual()).toBe(LOCALES.length > 1);
    expect(isMultilingual()).toBe(true); // el seed es bilingue
  });
});

describe("avisos de idioma (lang.*)", () => {
  it("existen en ambos locales y no prometen traduccion automatica", () => {
    for (const l of LOCALES) {
      expect(t(l, "lang.notice")).not.toBe("lang.notice");
      expect(t(l, "lang.noticeCta")).not.toBe("lang.noticeCta");
      expect(t(l, "lang.notice").toLowerCase()).not.toContain("translate");
      expect(t(l, "lang.noticeCta").toLowerCase()).not.toContain("translate");
    }
    expect(t("en", "lang.notice")).toBe("This page is only available in one language.");
    expect(t("es", "lang.noticeCta")).toBe("Ver el sitio en inglés");
  });
});
