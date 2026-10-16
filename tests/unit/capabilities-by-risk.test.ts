// §13.5 -- capacidades agrupadas por riesgo. El campo `risk` existia como
// dato decorativo (un badge por capacidad); ahora tambien es la ESTRUCTURA
// del Centro de Permisos y el resumen del dashboard. Este test fija el
// contrato de agrupacion y evita que una capacidad nueva quede sin nivel.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capabilityRegistry,
  listCapabilitiesByRisk,
  listCapabilitiesByCategory,
  RISK_LABELS,
  RISK_ORDER,
} from "../../packages/plugin-sandbox/src/capabilities/capability-registry";

const root = join(__dirname, "../..");
const allIds = Object.keys(capabilityRegistry);

describe("listCapabilitiesByRisk", () => {
  it("agrupa TODAS las capacidades, sin perder ni duplicar ninguna", () => {
    const byRisk = listCapabilitiesByRisk();
    const flat = RISK_ORDER.flatMap((risk) => byRisk[risk].map((c) => c.id));
    expect(flat.sort()).toEqual([...allIds].sort());
    expect(new Set(flat).size).toBe(allIds.length);
  });

  it("cada capacidad cae en el grupo de su propio nivel", () => {
    const byRisk = listCapabilitiesByRisk();
    for (const risk of RISK_ORDER) {
      for (const cap of byRisk[risk]) expect(cap.risk, cap.id).toBe(risk);
    }
  });

  it("las tres claves existen siempre, aunque un nivel quede vacio", () => {
    const byRisk = listCapabilitiesByRisk();
    expect(Object.keys(byRisk).sort()).toEqual(["alto", "bajo", "medio"]);
    for (const risk of RISK_ORDER) expect(Array.isArray(byRisk[risk])).toBe(true);
  });

  it("el nivel que coincide con la categoria no cambia el conteo total", () => {
    const byCategory = Object.values(listCapabilitiesByCategory()).flat();
    const byRisk = RISK_ORDER.flatMap((risk) => listCapabilitiesByRisk()[risk]);
    expect(byRisk.length).toBe(byCategory.length);
  });
});

describe("RISK_ORDER y RISK_LABELS", () => {
  it("el orden es de mas peligroso a menos", () => {
    expect([...RISK_ORDER]).toEqual(["alto", "medio", "bajo"]);
  });

  it("cada nivel tiene su etiqueta humana", () => {
    expect(RISK_LABELS).toEqual({ alto: "Alto riesgo", medio: "Riesgo medio", bajo: "Riesgo bajo" });
  });

  it("los niveles del catalogo son exactamente los de RISK_ORDER", () => {
    const levels = new Set(Object.values(capabilityRegistry).map((c) => c.risk));
    expect([...levels].sort()).toEqual([...RISK_ORDER].sort());
  });
});

describe("el Centro de Permisos usa la agrupacion por riesgo", () => {
  const ui = readFileSync(join(root, "packages/permissions/src/permission-center-ui.ts"), "utf8");

  it("agrupa por riesgo y ya no por categoria", () => {
    expect(ui).toContain("listCapabilitiesByRisk");
    expect(ui).toContain("RISK_ORDER");
    expect(ui).not.toContain("listCapabilitiesByCategory");
  });

  it("muestra la categoria como etiqueta secundaria (el dato que el riesgo no da)", () => {
    expect(ui).toContain("pc-cap-category");
    expect(ui).toContain("cap.category");
  });
});

describe("el dashboard muestra el resumen de riesgo", () => {
  const dash = readFileSync(join(root, "src/pages/admin/index.astro"), "utf8");

  it("renderiza las tres celdas de nivel desde RISK_ORDER", () => {
    expect(dash).toContain("listCapabilitiesByRisk");
    expect(dash).toContain("ai-risk-summary");
    expect(dash).toContain("RISK_ORDER.map");
  });

  it("cuenta las concedidas en runtime y degrada sin functions", () => {
    expect(dash).toContain('fetch("/admin/permissions"');
    expect(dash).toContain("requiere un nodo con functions");
  });
});
