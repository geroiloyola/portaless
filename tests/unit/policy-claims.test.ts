import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("B2: search/ai_train son señales cooperativas, no reglas por petición", () => {
  it("el panel rotula ambas reglas y solo ai_input como aplicada", () => {
    const panel = read("src/pages/admin/agents.astro");
    expect(panel).toContain("Señal cooperativa (no se aplica por petición)");
    expect(panel).toContain("Esta es la única regla que se aplica por petición");
    expect(panel).toContain("los buscadores que no firman reciben 403 en contenido");
  });

  it("README y home EN dicen que no se aplican por request", () => {
    expect(read("README.md")).toContain("not enforced per request");
    expect(read("src/content/home.json")).toContain("not enforced per request");
    expect(read("src/components/BetaPage.astro")).toContain("not enforced per request");
  });

  it("home ES y /beta ES dicen que no se aplican por petición", () => {
    expect(read("src/content/home.es.json")).toContain("no se aplican por petición");
    expect(read("src/components/BetaPage.astro")).toContain("no se aplican por petición");
  });
});
