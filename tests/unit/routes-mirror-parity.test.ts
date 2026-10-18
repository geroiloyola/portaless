// Paridad del espejo de rutas dentro de packages/atomic-elements.
// El paquete no puede importar el core (AGPL), igual que packages/plugin-sdk:
// declara su copia de los segmentos de URL y ESTE test falla si el espejo y
// src/lib/routes.ts se desincronizan.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_URL_SEGMENT, SHOP_URL_SEGMENT, pageUrlPath, productUrlPath, SHOP_PATH } from "../../packages/atomic-elements/src/seo/urls";
import { ROUTES, contentPagePath } from "../../src/lib/routes";

const root = join(__dirname, "../..");

const segmentOf = (route: string) => route.replace(/^\//, "");

describe("paridad del espejo de rutas (atomic-elements <-> src/lib/routes)", () => {
  it("los segmentos son los mismos que ROUTES", () => {
    expect(PAGE_URL_SEGMENT).toBe(segmentOf(ROUTES.PAGES));
    expect(SHOP_URL_SEGMENT).toBe(segmentOf(ROUTES.SHOP));
  });

  it("las funciones del espejo producen lo mismo que el modulo del core", () => {
    // contenido: la primaria (sin locale); el espejo emite sin barra final y
    // el core con ella -- misma ruta, distinta presentacion
    expect(pageUrlPath("bio")).toBe(contentPagePath("bio").replace(/\/$/, ""));
    // producto: handle simple
    expect(productUrlPath("polera")).toBe(`${ROUTES.SHOP}/polera`);
  });

  it("SHOP_PATH es la raiz de la tienda", () => {
    expect(SHOP_PATH.startsWith(`/${SHOP_URL_SEGMENT}/`)).toBe(true);
  });

  it("el core no fue importado por el paquete (frontera de licencias)", () => {
    const urlsSrc = readFileSync(join(root, "packages/atomic-elements/src/seo/urls.ts"), "utf8");
    expect(urlsSrc).not.toMatch(/from\s+"\.\.\/(\.\.\/)*src\//);
  });
});
