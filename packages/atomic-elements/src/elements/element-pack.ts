// Element packs: la capa abierta del catalogo de Atomic Elements.
//
// El catalogo CORE sigue cerrado (elementRegistry + la union ElementType).
// Un ElementPack es una contribucion DECLARATIVA y DATA-ONLY de un plugin:
// schema + template, NUNCA una funcion de render. La frontera no es capricho
// -- es el precedente que el repo ya probo con ProductGrid: el HOST guarda la
// funcion de render (registry.ts -> medusa-client -> commerce host-bridge) y
// el PLUGIN provee datos. Una funcion no cruza un isolated-vm, y el AST debe
// seguir siendo JSON serializable y determinista. Ver
// docs/architecture/element-catalog-plugins.md.
//
// Namespacing: un tipo de pack es "pack.Element" (ej. "demo.Badge"). No puede
// colisionar con un tipo core ni con otro pack, y hace que el error "tipo
// desconocido" sea accionable.
//
// Este archivo es PURO (sin DOM, sin DB, sin IO) -- igual que validateManifest
// del sandbox y que validatePageLayout. La persistencia vive en
// persistence/element-pack-store.ts.

import type { ElementDefinition } from "../types";

/** Una prop editable, mismo shape que ElementDefinition.editableProps. */
export interface ContributedEditableProp {
  key: string;
  label: string;
  kind: "text" | "textarea" | "url" | "number" | "color" | "select";
  options?: string[];
}

export interface ContributedRender {
  /** v1 acepta solo plantillas seguras que el host interpola y escapa. */
  kind: "html-template";
  /** "…{{clave}}…" interpolado y escapado por el host; "{{&children}}" inserta children ya renderizados. */
  template: string;
  /** Si true, en modo "static" el host emite un placeholder y el contenido real solo se resuelve a request time. */
  requiresEdgeEval?: boolean;
}

export interface ContributedElement {
  /** Namespaced: "demo.Badge". Debe contener "." y no puede ser un tipo core. */
  type: string;
  displayName: string;
  icon: string;
  defaultProps: Record<string, unknown>;
  editableProps: ContributedEditableProp[];
  render: ContributedRender;
  /** Claves de props consideradas sensibles (problema 3 del diseno). Informativo para el host. */
  secretProps?: string[];
}

export interface ElementPack {
  name: string;
  version: string;
  elements: ContributedElement[];
}

export interface PackValidationResult {
  valid: boolean;
  errors: string[];
}

// El catalogo core se inyecta para que un pack no pueda sombrear un tipo core.
// Se leen sus claves, no su valor, para no acoplar la validacion a ninguna
// implementacion concreta de render.
export function validateElementPack(
  pack: ElementPack,
  coreTypes: Iterable<string>
): PackValidationResult {
  const errors: string[] = [];
  const core = new Set(coreTypes);

  if (!pack?.name || typeof pack.name !== "string" || !pack.name.trim()) {
    errors.push('Falta "name" (string no vacio) del pack.');
  }
  if (!pack?.version || typeof pack.version !== "string" || !pack.version.trim()) {
    errors.push('Falta "version" (string no vacio) del pack.');
  }
  if (!Array.isArray(pack?.elements) || pack.elements.length === 0) {
    errors.push('"elements" debe ser un arreglo con al menos un elemento.');
    return { valid: false, errors };
  }

  const seen = new Set<string>();
  pack.elements.forEach((el, i) => {
    const at = `elements[${i}]`;
    if (!el?.type || typeof el.type !== "string") {
      errors.push(`${at}: falta "type".`);
      return;
    }
    if (!el.type.includes(".")) {
      errors.push(
        `${at}: el type "${el.type}" debe ser namespaced ("pack.Element") para no colisionar con el catalogo core.`
      );
    }
    if (core.has(el.type)) {
      errors.push(`${at}: el type "${el.type}" colisiona con un tipo core.`);
    }
    if (seen.has(el.type)) {
      errors.push(`${at}: type duplicado "${el.type}" dentro del pack.`);
    }
    seen.add(el.type);

    if (!el.displayName) errors.push(`${at}: falta "displayName".`);
    if (typeof el.icon !== "string") errors.push(`${at}: falta "icon" (string).`);
    if (typeof el.defaultProps !== "object" || el.defaultProps === null) {
      errors.push(`${at}: falta "defaultProps" (objeto).`);
    }
    if (!Array.isArray(el.editableProps)) {
      errors.push(`${at}: falta "editableProps" (arreglo).`);
    } else {
      el.editableProps.forEach((p, j) => {
        if (!p?.key) errors.push(`${at}.editableProps[${j}]: falta "key".`);
        if (!p?.label) errors.push(`${at}.editableProps[${j}]: falta "label".`);
      });
    }
    if (el.render?.kind !== "html-template") {
      errors.push(
        `${at}: render.kind debe ser "html-template" (v1 no ejecuta JS de plugin en el render).`
      );
    }
    if (typeof el.render?.template !== "string" || !el.render.template.trim()) {
      errors.push(`${at}: falta render.template (string no vacio).`);
    }
    if (el.secretProps !== undefined && !Array.isArray(el.secretProps)) {
      errors.push(`${at}: secretProps debe ser un arreglo de strings.`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** Una entrada del catalogo resuelto: core (funcion) o pack (template). */
export type CatalogEntry =
  | { kind: "core"; type: string; definition: ElementDefinition<Record<string, unknown>> }
  | { kind: "pack"; type: string; packName: string; element: ContributedElement };

export interface ResolvedCatalog {
  lookup(type: string): CatalogEntry | null;
  has(type: string): boolean;
  /** Todos los tipos (core ∪ packs), en orden de palette (core primero). */
  allTypes(): string[];
  /** Solo los tipos contribuidos por packs. */
  packTypes(): string[];
  /** Entradas para la paleta del editor, en orden. */
  palette(): CatalogEntry[];
}

/**
 * Fusiona el catalogo core (cerrado, tipado) con los packs (abiertos, DB) en
 * el lookup que consumen render, validacion, MCP y editor. Los packs NO pueden
 * sombrear tipos core: un type repetido se ignora a favor del core (defensa,
 * no confianza -- validateElementPack ya lo rechaza al registrar).
 */
export function resolveCatalog(
  coreRegistry: Record<string, ElementDefinition<Record<string, unknown>>>,
  corePalette: string[],
  packs: ElementPack[]
): ResolvedCatalog {
  const coreTypes = new Set(Object.keys(coreRegistry));
  const packTypeToEntry = new Map<string, CatalogEntry>();

  for (const pack of packs) {
    for (const el of pack?.elements ?? []) {
      if (!el?.type || coreTypes.has(el.type) || packTypeToEntry.has(el.type)) continue;
      packTypeToEntry.set(el.type, { kind: "pack", type: el.type, packName: pack.name, element: el });
    }
  }

  const orderedTypes = [...corePalette, ...packTypeToEntry.keys()];

  const lookup = (type: string): CatalogEntry | null => {
    const coreDef = coreRegistry[type];
    if (coreDef) return { kind: "core", type, definition: coreDef };
    return packTypeToEntry.get(type) ?? null;
  };

  return {
    lookup,
    has: (type: string) => lookup(type) !== null,
    allTypes: () => [...orderedTypes],
    packTypes: () => [...packTypeToEntry.keys()],
    palette: () => orderedTypes.map((t) => lookup(t)!).filter(Boolean),
  };
}

/** El catalogo sin packs: exactamente el core, para callers sin DB. */
export function coreCatalog(
  coreRegistry: Record<string, ElementDefinition<Record<string, unknown>>>,
  corePalette: string[]
): ResolvedCatalog {
  return resolveCatalog(coreRegistry, corePalette, []);
}
