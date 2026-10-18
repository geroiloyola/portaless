// TAREA 3. Dos contratos:
//   1. Los JSON de demo (src/content/pages) usan SOLO rutas nuevas
//      (/pages/, /shop/, /projections/) -- nunca las legadas.
//   2. /shop/<handle> cae a un estado vacio elegante (con vuelta a la tienda)
//      cuando el comercio esta deshabilitado o el handle no existe; el modulo
//      sigue siendo 100% opcional (getStaticPaths devuelve [] sin catalogo).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const pagesDir = join(root, "src/content/pages");
const handleSrc = readFileSync(join(root, "src/pages/shop/[handle].astro"), "utf8");

describe("JSON de demo: solo rutas nuevas", () => {
  const files = readdirSync(pagesDir).filter((f) => f.endsWith(".json"));

  it("hay paginas de demo para revisar", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ningun JSON referencia /paginas/, /tienda o /proyecciones", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(join(pagesDir, file), "utf8");
      for (const legacy of ["/paginas/", "/tienda", "/proyecciones"]) {
        if (raw.includes(legacy)) offenders.push(`${file}: ${legacy}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("los enlaces internos de los JSON apuntan a rutas nuevas cuando aparecen", () => {
    for (const file of files) {
      const raw = readFileSync(join(pagesDir, file), "utf8");
      // Si hay un enlace a la tienda o a las paginas, debe ser la ruta nueva.
      expect(raw).not.toMatch(/"\/tienda/);
      expect(raw).not.toMatch(/"\/paginas/);
    }
  });
});

describe("/shop/<handle>: fallback estatico sin romper", () => {
  it("getStaticPaths devuelve [] si el comercio no esta habilitado", () => {
    expect(handleSrc).toMatch(/if \(!\(await enabled\(\)\)\) return \[\];/);
  });

  it("un catalogo que falla en build no rompe el build (catch -> [])", () => {
    expect(handleSrc).toMatch(/catch \{[\s\S]*?return \[\];/);
  });

  it("el estado vacio es una tarjeta elegante con vuelta a la tienda", () => {
    expect(handleSrc).toContain('class="empty-state"');
    expect(handleSrc).toContain("Product not found");
    expect(handleSrc).toContain("Back to the store");
    expect(handleSrc).toContain("shop/");
  });

  it("no queda ningun mensaje de error crudo ni el texto viejo", () => {
    expect(handleSrc).not.toContain("Producto no encontrado o comercio no habilitado");
    expect(handleSrc).not.toContain("no incluido en Portaless por diseño");
  });
});
