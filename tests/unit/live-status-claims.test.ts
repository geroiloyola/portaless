import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const CURRENT_STATUS_FILES = [
  "README.md",
  "SECURITY.md",
  "src/components/BetaPage.astro",
  "src/content/home.json",
  "src/content/home.es.json",
];

const FORBIDDEN_STATUS = [
  /public Beta/i,
  /alpha\s*\/\s*MVP/i,
  /Status:\s*Alpha/i,
  /primer Beta publico/i,
  /Beta publico/i,
  /Beta p[uú]blica/i,
];

describe("A2: el estado vivo es Beta, invite-only", () => {
  it("no quedan 'public Beta' ni 'alpha/MVP' en las superficies de estado", () => {
    const bad: string[] = [];
    for (const file of CURRENT_STATUS_FILES) {
      const content = read(file);
      for (const pattern of FORBIDDEN_STATUS) {
        if (pattern.test(content)) bad.push(`${file}: ${pattern}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("README, SECURITY, /beta y home dicen Beta invite-only", () => {
    expect(read("README.md")).toContain("Beta, invite-only");
    expect(read("SECURITY.md")).toContain("Beta, invite-only");
    expect(read("src/components/BetaPage.astro")).toContain("Beta, invite-only");
    expect(read("src/components/BetaPage.astro")).toContain("Beta, solo por invitación");
    expect(read("src/content/home.json")).toContain("Beta, invite-only");
    expect(read("src/content/home.es.json")).toContain("Beta, solo por invitación");
  });

  it("el encabezado actual del CHANGELOG no usa el estado viejo", () => {
    const head = read("CHANGELOG.md").split("## v0.0.11")[0];
    for (const pattern of FORBIDDEN_STATUS) {
      expect(head, `CHANGELOG.md head: ${pattern}`).not.toMatch(pattern);
    }
    expect(head).toContain("Beta, invite-only");
  });

  it("'official Beta' no se usa como estado actual fuera del ROADMAP", () => {
    for (const file of CURRENT_STATUS_FILES) {
      expect(read(file), file).not.toMatch(/official Beta/i);
    }
  });
});

describe("A6: los snapshots de cobertura vivos están fechados/corregidos", () => {
  it("ROADMAP.md publica los pisos actuales", () => {
    const roadmap = read("ROADMAP.md");
    expect(roadmap).toContain("68 lines / 67 statements / 66 functions / 65 branches");
  });

  it("ROADMAP_es.md ya no afirma que los mínimos vigentes son 45/44/46/40", () => {
    const roadmapEs = read("ROADMAP_es.md");
    expect(roadmapEs).toContain("68/67/66/65");
    expect(roadmapEs).not.toMatch(/minimos 45\/44\/46\/40/i);
    expect(roadmapEs).not.toMatch(/de 45\/44\/46\/40 hacia/i);
  });
});
