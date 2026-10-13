// packages/dashboard/src/skin-engine/site-skin-store.ts: skin activo del
// sitio. Tres backends con el mismo contrato (D1 fake sobre
// better-sqlite3, SQLite real en archivo temporal,
// InMemory), upsert por site, sanitizacion de tokens (barrera de CSS
// injection), emision de la hoja CSS publica (bloques claro/oscuro) y
// resolucion del skin activo con overrides de marca aplicados a ambos
// temas.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  D1SiteSkinStore,
  SqliteSiteSkinStore,
  InMemorySiteSkinStore,
  createSiteSkinStore,
  resolveActiveSkin,
  emitSiteSkinCss,
  sanitizeTokens,
  isSafeTokenValue,
  isSkinName,
  SITE_SKIN_TABLE_DDL,
  SITE_ID,
  SKIN_NAMES,
} from "../../packages/dashboard/src/skin-engine/site-skin-store";
import { DEFAULT_TOKENS, DEFAULT_DARK_TOKENS } from "../../packages/dashboard/src/skin-engine/tokens";

const tmp = mkdtempSync(join(tmpdir(), "portaless-site-skin-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

async function roundTrip(store: { get: Function; set: Function }) {
  expect(await store.get(SITE_ID)).toBeNull();

  const created = await store.set(SITE_ID, "blog", { accent: "#AABBCC" });
  expect(created.skin).toBe("blog");
  expect(created.tokens.accent).toBe("#AABBCC");

  const loaded = await store.get(SITE_ID);
  expect(loaded?.skin).toBe("blog");
  expect(loaded?.tokens.accent).toBe("#AABBCC");

  const updated = await store.set(SITE_ID, "tienda", { accent: "#123456", bg: "#FFFFFF" });
  expect(updated.skin).toBe("tienda");
  const reloaded = await store.get(SITE_ID);
  expect(reloaded?.skin).toBe("tienda");
  expect(reloaded?.tokens.accent).toBe("#123456");
  expect(reloaded?.tokens.bg).toBe("#FFFFFF");

  const other = await store.get("otro-site");
  expect(other).toBeNull();
}

describe("SiteSkinStore: tres backends, mismo contrato", () => {
  it("InMemory: round-trip + upsert", async () => {
    await roundTrip(new InMemorySiteSkinStore());
  });

  it("SQLite (archivo temporal): round-trip + upsert", async () => {
    const store = await SqliteSiteSkinStore.open(join(tmp, "skin-sqlite.db"));
    await roundTrip(store);
    store.close();
  });

  it("D1 (fake sobre better-sqlite3): round-trip + upsert", async () => {
    // Sin applySchema: las stores crean su propia tabla via
    // SITE_SKIN_TABLE_DDL (applySchema(db) con una instancia Database no
    // hacia nada y dejaba una promesa rechazada sin manejar).
    const db = new Database(":memory:");
    await roundTrip(new D1SiteSkinStore(fakeD1(db)));
    db.close();
  });

  it("factory: DB -> D1, PORTALESS_SQLITE_PATH -> SQLite, si no InMemory", async () => {
    const db = new Database(":memory:");
    const d1 = await createSiteSkinStore({ DB: fakeD1(db) });
    expect(d1).toBeInstanceOf(D1SiteSkinStore);

    const sqlitePath = join(tmp, "skin-factory.db");
    const sqlite = await createSiteSkinStore({ PORTALESS_SQLITE_PATH: sqlitePath });
    expect(sqlite).toBeInstanceOf(SqliteSiteSkinStore);

    const mem = await createSiteSkinStore({});
    expect(mem).toBeInstanceOf(InMemorySiteSkinStore);
    db.close();
  });

  it("el DDL declarado crea la tabla site_skin", () => {
    expect(SITE_SKIN_TABLE_DDL).toContain("CREATE TABLE IF NOT EXISTS site_skin");
  });
});

describe("sanitizeTokens: barrera de CSS injection", () => {
  it("valores seguros pasan (hex, px, palabras)", () => {
    const { tokens, rejected } = sanitizeTokens({
      accent: "#C5D86D",
      radius: "22px",
      density: "comfortable",
      bg: "rgb(1, 2, 3)",
    });
    expect(rejected).toEqual([]);
    expect(tokens.accent).toBe("#C5D86D");
    expect(tokens.radius).toBe("22px");
    expect(tokens.bg).toBe("rgb(1, 2, 3)");
  });

  it("rechaza llaves, punto y coma, comillas y markup (inyeccion CSS/HTML)", () => {
    const { tokens, rejected } = sanitizeTokens({
      accent: "#fff; } body { display: none",
      bg: "url(javascript:x)",
      text: "<script>x</script>",
      panelBg: "#C5D86D",
    });
    expect(rejected).toEqual(expect.arrayContaining(["accent", "bg", "text"]));
    expect(tokens.accent).toBeUndefined();
    expect(tokens.text).toBeUndefined();
    expect(tokens.panelBg).toBe("#C5D86D");
  });

  it("rechaza claves desconocidas y valores no-string", () => {
    const { tokens, rejected } = sanitizeTokens({ unknownKey: "#fff", accent: 42, __proto__: "#fff" });
    expect(rejected).toEqual(expect.arrayContaining(["unknownKey", "accent"]));
    expect(tokens).toEqual({});
  });

  it("isSafeTokenValue: largo maximo 40 y sin caracteres peligrosos", () => {
    expect(isSafeTokenValue("#C5D86D")).toBe(true);
    expect(isSafeTokenValue("a".repeat(40))).toBe(true);
    expect(isSafeTokenValue("a".repeat(41))).toBe(false);
    expect(isSafeTokenValue(undefined)).toBe(false);
    expect(isSafeTokenValue("red;}")).toBe(false);
  });
});

describe("resolveActiveSkin: cadena del skin + overrides de marca", () => {
  it("sin overrides devuelve la paleta oficial resuelta de base", async () => {
    const { light, dark } = await resolveActiveSkin("base", {});
    expect(light.accent).toBe(DEFAULT_TOKENS.accent);
    expect(light.accentText).toBe(DEFAULT_TOKENS.accentText);
    expect(dark.bg).toBe(DEFAULT_DARK_TOKENS.bg);
    expect(dark.text).toBe(DEFAULT_DARK_TOKENS.text);
  });

  it("un override de accent aplica en claro Y en oscuro (claves de marca)", async () => {
    const { light, dark } = await resolveActiveSkin("base", { accent: "#FF00AA" });
    expect(light.accent).toBe("#FF00AA");
    expect(dark.accent).toBe("#FF00AA");
    // bg/text NO se tocan en el tema oscuro con un override de marca.
    expect(dark.bg).toBe(DEFAULT_DARK_TOKENS.bg);
    expect(dark.text).toBe(DEFAULT_DARK_TOKENS.text);
  });

  it("un override de bg solo aplica al tema claro", async () => {
    const { light, dark } = await resolveActiveSkin("base", { bg: "#FFFDF5" });
    expect(light.bg).toBe("#FFFDF5");
    expect(dark.bg).toBe(DEFAULT_DARK_TOKENS.bg);
  });

  it("skin invalido cae a base (nunca lanza)", async () => {
    const { light } = await resolveActiveSkin("no-existe", {});
    expect(light.accent).toBe(DEFAULT_TOKENS.accent);
  });

  it("herencia: tienda mantiene el accent propio y el resto del base", async () => {
    const { light } = await resolveActiveSkin("tienda", {});
    expect(light.accent).toBe("#a06bff");
    expect(light.bg).toBe("#F7F7F2");
  });

  it("herencia (Phase 2): portafolio y lanzamiento resuelven sus acentos y heredan el resto del base", async () => {
    const port = await resolveActiveSkin("portafolio", {});
    expect(port.light.accent).toBe("#9BB56A");
    expect(port.light.accentText).toBe("#4A5A1E");
    expect(port.light.radius).toBe("14px");
    // Hereda del base los tokens que no overridea.
    expect(port.light.panelBg).toBe(DEFAULT_TOKENS.panelBg);
    expect(port.light.muted).toBe(DEFAULT_TOKENS.muted);

    const lanz = await resolveActiveSkin("lanzamiento", {});
    expect(lanz.light.accent).toBe("#F05D23");
    expect(lanz.light.accent2).toBe("#C5D86D");
    expect(lanz.light.density).toBe("compact");
    expect(lanz.light.panelBg).toBe(DEFAULT_TOKENS.panelBg);
  });
});

describe("emitSiteSkinCss: hoja publica", () => {
  it("emite bloques claro, @media oscuro y data-theme oscuro (selectores html:root)", async () => {
    const { light, dark } = await resolveActiveSkin("base", { accent: "#AABBCC" });
    const css = emitSiteSkinCss(light, dark);
    expect(css).toContain("html:root {");
    expect(css).toContain("--accent: #AABBCC;");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain('html:root[data-theme="dark"]');
    expect(css).toContain(`--bg: ${DEFAULT_DARK_TOKENS.bg};`);
    expect(css).toContain("--accent-text:");
  });

  it("defensa en profundidad: un valor inseguro no llega al CSS emitido", () => {
    const css = emitSiteSkinCss(
      { accent: "#fff; } body { display: none", bg: "#F7F7F2" },
      DEFAULT_DARK_TOKENS
    );
    expect(css).not.toContain("display: none");
    expect(css).not.toContain("body {");
    expect(css).toContain("--bg: #F7F7F2;");
  });
});

describe("isSkinName / SKIN_NAMES", () => {
  it("acepta los 6 skins y rechaza cualquier otra cosa", () => {
    expect(SKIN_NAMES).toEqual(["base", "blog", "tienda", "trust-crm", "portafolio", "lanzamiento"]);
    for (const name of SKIN_NAMES) expect(isSkinName(name)).toBe(true);
    expect(isSkinName("hacker")).toBe(false);
    expect(isSkinName(undefined)).toBe(false);
  });
});
