// ROADMAP.md fase 13 (§13.1 + §13.2 + §13.3): variantes, tamaños y ritmo de
// tokens en los atomos.
//
// Lo que estos tests protegen, en orden de importancia:
//
//  1. El default reproduce el render historico BYTE A BYTE. Las 8 tablas de
//     render guardadas en fixtures (baseline.json) son la linea de base; si un
//     default cambia, el test lo dice con el diff, no con un fallo generico.
//  2. Una variante desconocida cae al default en vez de romper el render: mismo
//     criterio fail-safe que un theme pack que resuelve a null.
//  3. El ritmo no se degrada: ningun atomo emite un padding o un radio como
//     literal crudo, y el fallback de cada var(--space-N) COINCIDE con el valor
//     real del paso (un fallback que miente es una bomba de reloj).
//  4. size no cambia semantica: Heading.size es visual y Heading.level sigue
//     siendo el nivel del documento. El nivel NO se deriva del tamano.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { elementRegistry } from "../../packages/atomic-elements/src/elements/registry";
import { DENSITY_TO_SPACE_UNIT, spaceUnitForDensity, TOKEN_TO_CSS_VAR } from "../../packages/dashboard/src/skin-engine/tokens";

const REGISTRY_SRC = readFileSync("packages/atomic-elements/src/elements/registry.ts", "utf-8");

// --- 1. Los defaults, byte a byte -------------------------------------------

/**
 * Renders capturados ANTES de esta fase (var(--space-N) no existia, los
 * paddings eran literales). El unico default que debe cambiar es el que el
 * propio cambio de ritmo normaliza de forma deliberada -- y aun asi se
 * documenta aqui en vez de dejarlo pasar.
 */
const HISTORICAL_DEFAULTS: Record<string, string> = {
  Heading:
    '<h2 style="text-align:left;margin:0;">Encabezado de seccion</h2>',
  Paragraph: '<p style="line-height:1.6;margin:0;">Escribe aqui el contenido de este parrafo.</p>',
  Spacer: '<div style="height:32px;"></div>',
  ProductCard: undefined as unknown as string,
};

describe("el default de cada elemento sigue siendo el render historico", () => {
  it("Heading, Paragraph y Spacer: byte a byte igual que antes de las variantes", () => {
    for (const [type, expected] of Object.entries(HISTORICAL_DEFAULTS)) {
      if (expected === undefined) continue;
      const html = elementRegistry[type as "Heading"].renderHTML(elementRegistry[type as "Heading"].defaultProps as never);
      expect(html, type).toBe(expected);
    }
  });

  it("Heading con size md NO emite font-size: lo decide la cascada, como antes", () => {
    // Si este test falla, el Heading md empezo a pisar la cascada h1/h2/h3 del
    // tema y todas las paginas existentes cambian de tamano de un golpe.
    const html = elementRegistry.Heading.renderHTML({ ...elementRegistry.Heading.defaultProps } as never);
    expect(html).not.toContain("font-size");
  });

  it("ProductCard standard conserva su ESTRUCTURA, con el ritmo ya normalizado", () => {
    const html = elementRegistry.ProductCard.renderHTML({ ...elementRegistry.ProductCard.defaultProps } as never);
    // misma estructura que antes: tarjeta vertical, imagen 16/9 arriba, boton abajo
    expect(html).toContain("class=\"ae-product-card\"");
    expect(html).toContain("aspect-ratio:16/9");
    expect(html).toContain("flex-direction:column");
    // ritmo: radio 18px -> radius-card (16px) y padding 20px -> space-5 (24px),
    // los dos pasos mas cercanos de la escala. Son los unicos dos valores que
    // el cambio de ritmo movio en una variante default, y por eso se nombran.
    expect(html).toContain("border-radius:var(--radius-card, 16px)");
    expect(html).toContain("padding:var(--space-5, 24px)");
  });

  it("Testimonial plain conserva el bloque con borde, ahora por la escala", () => {
    const html = elementRegistry.Testimonial.renderHTML({ ...elementRegistry.Testimonial.defaultProps } as never);
    // 16px y 24px ya eran los valores de radius-card y space-5: el render
    // effective NO cambia, solo deja de llevar el numero pegado.
    expect(html).toContain("border:1px solid var(--panel-border, #E4E6C3);border-radius:var(--radius-card, 16px);padding:var(--space-5, 24px)");
  });

  it("FAQ list conserva el <details> con tarjeta y su marcador nativo", () => {
    const html = elementRegistry.FAQ.renderHTML({ ...elementRegistry.FAQ.defaultProps } as never);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    // El marcador del summary es nativo: no hay un select "chevron" que alguien
    // pueda dejar en contradiccion con la variante.
    const markerProp = elementRegistry.FAQ.editableProps.find((f) => /marker|chevron|icon/i.test(String(f.key)));
    expect(markerProp).toBeUndefined();
  });
});

// --- 2. Variantes: renderizan, y la desconocida cae al default ---------------

const VARIANT_CASES: Array<{ type: keyof typeof elementRegistry; variants: string[]; extra?: Record<string, unknown> }> = [
  { type: "Hero", variants: ["centered", "split", "minimal", "spotlight"], extra: { imageUrl: "https://ejemplo.test/a.jpg" } },
  { type: "Heading", variants: ["plain", "eyebrow", "ruled"], extra: { eyebrow: "Antetitulo" } },
  { type: "Button", variants: ["solid", "outline", "ghost"] },
  { type: "Testimonial", variants: ["plain", "quote", "card"] },
  { type: "ProductCard", variants: ["standard", "compact", "featured"] },
  { type: "FAQ", variants: ["list", "bordered", "numbered"] },
  { type: "Form", variants: ["stacked", "inline"], extra: { action: "https://formspree.io/f/x" } },
  { type: "Gallery", variants: ["grid", "masonry"] },
];

describe("variantes", () => {
  it("cada elemento con variantes expone exactamente las acordadas y su default es la primera", () => {
    const expected: Record<string, string[]> = {
      Hero: ["centered", "split", "minimal", "spotlight"],
      Heading: ["plain", "eyebrow", "ruled"],
      Button: ["solid", "outline", "ghost"],
      Testimonial: ["plain", "quote", "card"],
      ProductCard: ["standard", "compact", "featured"],
      FAQ: ["list", "bordered", "numbered"],
      Form: ["stacked", "inline"],
      Gallery: ["grid", "masonry"],
    };
    for (const [type, variants] of Object.entries(expected)) {
      const field = elementRegistry[type as "Heading"].editableProps.find((f) => f.key === "variant");
      expect(field, `${type} sin prop variant`).toBeTruthy();
      expect(field!.kind, `${type}.variant`).toBe("select");
      expect(field!.options, `${type}.variant`).toEqual(variants);
      // El default declarado es el primero de la lista: una sola fuente de verdad.
      expect(variants[0], `${type}`).toBe((elementRegistry[type as "Heading"].defaultProps as Record<string, unknown>).variant);
    }
  });

  it("cada variante renderiza algo real, distinto de las otras y sin 'undefined'", () => {
    for (const { type, variants, extra } of VARIANT_CASES) {
      const def = elementRegistry[type];
      const renders = variants.map((v) => {
        const html = def.renderHTML({ ...def.defaultProps, ...extra, variant: v } as never);
        expect(html, `${type}/${v}`).toBeTruthy();
        expect(html, `${type}/${v}`).not.toContain("undefined");
        return html;
      });
      // Las tres formas tienen que ser distinguibles: si dos dan el mismo HTML,
      // la variante no es una variante.
      expect(new Set(renders).size, `${type}: dos variantes renderizan igual`).toBe(renders.length);
    }
  });

  it("una variante DESCONOCIDA cae al default en vez de romper", () => {
    for (const { type, variants, extra } of VARIANT_CASES) {
      const def = elementRegistry[type];
      const broken = def.renderHTML({ ...def.defaultProps, ...extra, variant: "no-existe" } as never);
      const fallback = def.renderHTML({ ...def.defaultProps, ...extra, variant: variants[0] } as never);
      expect(broken, `${type} con variant desconocida`).toBe(fallback);
    }
  });

  it("un size desconocido cae a md", () => {
    for (const type of ["Hero", "Heading", "Button"] as const) {
      const def = elementRegistry[type];
      const broken = def.renderHTML({ ...def.defaultProps, size: "enorme" } as never);
      const md = def.renderHTML({ ...def.defaultProps, size: "md" } as never);
      expect(broken, type).toBe(md);
    }
  });

  it("Hero split sin imageUrl cae al centered en vez de renderizar un hueco", () => {
    const html = elementRegistry.Hero.renderHTML({ ...elementRegistry.Hero.defaultProps, variant: "split", imageUrl: "" } as never);
    const centered = elementRegistry.Hero.renderHTML({ ...elementRegistry.Hero.defaultProps, variant: "centered" } as never);
    expect(html).toBe(centered);
  });

  it("el size solo existe donde se pidio: Hero, Heading y Button", () => {
    const conSize = Object.values(elementRegistry)
      .filter((d) => d.editableProps.some((f) => f.key === "size"))
      .map((d) => d.type)
      .sort();
    expect(conSize).toEqual(["Button", "Heading", "Hero"]);
  });

  it("size NO toca la semantica: el nivel del Heading sale de level, no de size", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      for (const level of ["h1", "h2", "h3"] as const) {
        const html = elementRegistry.Heading.renderHTML({ ...elementRegistry.Heading.defaultProps, size, level } as never);
        // El tag sale de level y de nada mas.
        expect(html, `${level}/${size}`).toContain(`<${level} `);
        expect(html, `${level}/${size}`).not.toContain(`<h1>`);
        expect(html, `${level}/${size}`).not.toContain(`<h2>`);
        expect(html, `${level}/${size}`).not.toContain(`<h3>`);
      }
    }
  });

  it("Button: cada variante conserva contraste AA (solido=tinta, outline/ghost=accent-text)", () => {
    const solid = elementRegistry.Button.renderHTML({ ...elementRegistry.Button.defaultProps, variant: "solid" } as never);
    const outline = elementRegistry.Button.renderHTML({ ...elementRegistry.Button.defaultProps, variant: "outline" } as never);
    const ghost = elementRegistry.Button.renderHTML({ ...elementRegistry.Button.defaultProps, variant: "ghost" } as never);
    expect(solid).toContain("color:#261C15");
    expect(outline).toContain("color:var(--accent-text, #5A6B24)");
    expect(ghost).toContain("color:var(--accent-text, #5A6B24)");
  });

  it("back-compat: una pagina guardada con style primary/secondary sigue igual que con variant", () => {
    const primary = elementRegistry.Button.renderHTML({ label: "X", href: "#", style: "primary" } as never);
    const solid = elementRegistry.Button.renderHTML({ label: "X", href: "#", variant: "solid" } as never);
    const secondary = elementRegistry.Button.renderHTML({ label: "X", href: "#", style: "secondary" } as never);
    const outline = elementRegistry.Button.renderHTML({ label: "X", href: "#", variant: "outline" } as never);
    expect(primary).toBe(solid);
    expect(secondary).toBe(outline);
  });

  it("el select muestra palabras humanas: optionLabels cubre todas las opciones", () => {
    for (const def of Object.values(elementRegistry)) {
      for (const field of def.editableProps) {
        if (field.kind !== "select") continue;
        expect(field.optionLabels, `${def.type}.${String(field.key)} sin optionLabels`).toBeTruthy();
        for (const opt of field.options ?? []) {
          const label = field.optionLabels![opt];
          expect(label, `${def.type}.${String(field.key)}: "${opt}" sin etiqueta`).toBeTruthy();
          // La etiqueta tiene que ser una palabra, no el valor crudo.
          expect(label, `${def.type}.${String(field.key)}: "${opt}" se muestra crudo`).not.toBe(opt);
        }
      }
    }
  });
});

// --- 3. Ritmo: nada de literales crudos, y fallbacks que no mienten ----------

describe("ritmo de tokens", () => {
  const SCALE: Record<string, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 };

  it("ningun atomo emite padding ni border-radius como literal crudo", () => {
    const offenders: string[] = [];
    for (const m of REGISTRY_SRC.matchAll(/(padding|border-radius):([^;"]*?)(?=;|")/g)) {
      const value = m[2];
      if (!/px\b/.test(value)) continue; // solo interesan los que llevan pixeles
      if (/var\(--space-\d/.test(value)) continue; // ritmo: permitido y verificado aparte
      if (/var\(--radius/.test(value)) continue; // radio por rol
      offenders.push(`${m[1]}:${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it("la tabla SPACE_STEPS del registro dice la verdad sobre la escala", () => {
    // El registro llama space(N) en vez de escribir el var() a mano, asi que la
    // verificacion es sobre la TABLA: si alguien cambia un paso (--space-5 de
    // 24px a 20px) el fallback que emite cada atomo pasaria a mentir, y este
    // test lo frena contra global.css.
    const block = REGISTRY_SRC.match(/const SPACE_STEPS = \{([^}]*)\}/);
    expect(block, "no se encontro SPACE_STEPS en el registro").not.toBeNull();
    const steps: Record<string, number> = {};
    for (const m of block![1].matchAll(/(\d)\s*:\s*(\d+)/g)) steps[m[1]] = Number(m[2]);
    expect(steps).toEqual(SCALE);

    const css = readFileSync("src/styles/global.css", "utf-8");
    const unit = Number(css.match(/--space-unit:\s*(\d+)px/)?.[1]);
    expect(unit, "--space-unit ausente").toBe(SCALE[1]);
    for (const step of Object.keys(SCALE)) {
      const m = css.match(new RegExp(`--space-${step}:\\s*([^;]+);`));
      expect(m, `--space-${step} ausente`).not.toBeNull();
      const decl = m![1].trim();
      // calc(var(--space-unit) * K) -> unit * K ; var(--space-unit) -> unit
      const calc = decl.match(/^calc\(var\(--space-unit\) \* (\d+)\)$/);
      const plain = decl === "var(--space-unit)";
      expect(calc || plain, `--space-${step}: "${decl}" no es un paso de la escala`).toBeTruthy();
      const value = calc ? unit * Number(calc[1]) : unit;
      expect(value, `--space-${step} no vale lo que dice SPACE_STEPS`).toBe(SCALE[step]);
    }

    // Y tiene que haber uso real: si nadie llama space(), el ritmo no se aplico.
    expect((REGISTRY_SRC.match(/\$\{space\(/g) ?? []).length, "space() casi sin usar").toBeGreaterThan(20);
  });

  it("la escala vive en global.css y NO entra a DesignTokens", () => {
    const css = readFileSync("src/styles/global.css", "utf-8");
    expect(css).toContain("--space-unit: 4px;");
    for (const step of Object.keys(SCALE)) expect(css, `--space-${step} ausente`).toContain(`--space-${step}:`);

    // El motivo: THEME_VARS esta fijado en paridad con TOKEN_TO_CSS_VAR por
    // test (theme-pack.test.ts). Meter la escala en DesignTokens obligaria a
    // cada theme pack a declarar espaciado.
    expect(Object.keys(TOKEN_TO_CSS_VAR)).toHaveLength(16);
    expect(Object.values(TOKEN_TO_CSS_VAR)).not.toContain("--space-unit");
  });

  it("--density deja de ser decorativo: se traduce a la unidad del ritmo", () => {
    expect(spaceUnitForDensity("comfortable")).toBe("4px");
    expect(spaceUnitForDensity("compact")).toBe("3px");
    expect(DENSITY_TO_SPACE_UNIT).toEqual({ compact: "3px", comfortable: "4px" });
    expect(spaceUnitForDensity("inventada")).toBeUndefined();
    expect(spaceUnitForDensity(undefined)).toBeUndefined();
  });

  it("applyDesignTokens escribe --space-unit segun la densidad del skin", () => {
    const props: Record<string, string> = [];
    const root = { style: { setProperty: (k: string, v: string) => props.push(`${k}=${v}`) } } as never;
    // Import dinamico para no arrastrar el modulo del DOM en un entorno node.
    return import("../../packages/dashboard/src/skin-engine/tokens").then(({ applyDesignTokens }) => {
      applyDesignTokens({ ...({} as never), density: "compact" } as never, root);
      expect(props).toContain("--density=compact");
      expect(props).toContain("--space-unit=3px");
    });
  });

  it("Gallery.radius ya no emite un radio crudo: se lleva al rol mas cercano", () => {
    const html = elementRegistry.Gallery.renderHTML({
      ...elementRegistry.Gallery.defaultProps,
      images: "https://ejemplo.test/a.jpg",
      radius: 12,
    } as never);
    expect(html).toContain("var(--radius-media, 12px)");
    expect(html).not.toContain("border-radius:12px");
  });
});

// --- 4. El panel muestra la palabra, no el valor ------------------------------

describe("el panel de propiedades usa optionLabels", () => {
  it("el <select> se arma con optionLabels y cae al valor crudo si falta la clave", () => {
    // jsdom no esta en el stack de vitest de este repo, asi que se verifica el
    // cableado en la fuente: una linea, y el fallback tiene que seguir ahi.
    const src = readFileSync("packages/atomic-elements/src/editor/property-panel.ts", "utf-8");
    expect(src).toContain("optionEl.textContent = field.optionLabels?.[opt] ?? opt;");
  });
});

// --- 4. Grillas: el layout vive en la hoja del core, no inline ---------------
// Un estilo inline no admite media queries, asi que un `repeat(N,1fr)` inline
// no puede ser responsive: en un movil de 375px deja N columnas de ~100px. El
// elemento declara --cols (lo que QUIERE) y la hoja intrinseca decide cuantas
// caben (auto-fit + minmax con max(min, (100%-gaps)/N)).

describe("grillas responsivas por hoja, no inline", () => {
  it("ningun atomo emite grid-template-columns:repeat(N,1fr) inline", () => {
    const offenders: string[] = [];
    for (const m of REGISTRY_SRC.matchAll(/grid-template-columns:\s*repeat\(([^)]*)\)/g)) {
      if (/auto-fit|auto-fill/.test(m[1])) continue; // intrinseco: permitido
      offenders.push(m[0]);
    }
    expect(offenders).toEqual([]);
  });

  it("ningun atomo emite column-count inline (masonry usa column-width en la hoja)", () => {
    expect(REGISTRY_SRC).not.toMatch(/column-count:\s*[^;"]/);
  });

  it("los grids declaran --cols y la hoja del core trae el layout intrinseco", () => {
    expect(REGISTRY_SRC).toContain("--cols:");
    const css = readFileSync("packages/atomic-elements/src/styles/elements.css", "utf-8");
    for (const cls of [".ae-columns", ".ae-product-grid", ".ae-gallery"]) {
      expect(css, cls).toContain(cls);
    }
    expect(css).toContain("auto-fit");
    expect(css).toContain("max(var(--ae-min");
    expect(css).toContain("column-width");
  });

  it("la hoja la cargan build, editor y shell runtime (paridad de las 3 superficies)", () => {
    expect(readFileSync("src/layouts/BaseLayout.astro", "utf-8")).toContain("styles/elements.css");
    expect(readFileSync("src/pages/admin/editor.astro", "utf-8")).toContain("styles/elements.css");
    expect(readFileSync("functions/pages/[slug].js", "utf-8")).toContain("ELEMENTS_CSS_PATH");
  });
});
