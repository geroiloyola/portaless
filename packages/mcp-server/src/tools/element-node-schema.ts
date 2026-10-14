// Schema Zod de un ElementNode, compartido por todas las tools de contenido
// del MCP server (create_page, update_page, insert_block, update_block,
// delete_block).
//
// EL PUNTO DE ESTE ARCHIVO: el enum de `type` se deriva de elementRegistry en
// tiempo de import, NO se hardcodea. Antes cada tool mantenia su propia copia
// del enum y las copias se desincronizaban del registro real: cuando se
// agregaron Video/FAQ/Testimonial/Form/Gallery al registry (y a
// elementPalette), los schemas de create_page/update_page quedaron en 12 tipos
// y un agente que compusiera un FAQ valido recibia un error de Zod, aunque
// elementRegistry y PageStore ya lo soportaban. Derivar el enum aqui mata esa
// clase de bug de raiz: agregar un ElementType a atomic-elements hace que todas
// lo acepten, sin tocar el MCP server.
//
// SEGURIDAD DE IMPORT: elementRegistry es puro (constantes de string y
// object-literals). Los unicos usos de `document` en elements/ estan dentro de
// iconOnly()/iconLabel() (elements/icons.ts), que solo se invocan en el
// navegador. Importar el registro no ejecuta renderHTML ni toca el DOM.
//
// ELEMENT PACKS (v0.0.9.11): el catalogo core sigue cerrado, pero un plugin
// puede contribuir elementos namespaced ("demo.Badge") via element packs --
// ver docs/architecture/element-catalog-plugins.md. Como esos tipos existen
// en la DB y no en el enum de compile-time, `type` acepta aqui el enum core O
// cualquier string namespaced (con "."). ESO NO ES LA AUTORIDAD: el membership
// real lo valida cada tool contra el catalogo resuelto (core ∪ packs) en
// tiempo de call. Este schema solo valida la FORMA.

import { z } from "zod";
import { elementRegistry } from "../../../atomic-elements/src/elements/registry";
import { elementPalette } from "../../../atomic-elements/src/elements/registry";
import { coreCatalog } from "../../../atomic-elements/src/elements/element-pack";
import type { ResolvedCatalog } from "../../../atomic-elements/src/elements/element-pack";
import type { ElementNode } from "../../../atomic-elements/src/types";

/** Tipos core, leidos del registro. Nunca los liste a mano. */
export const ELEMENT_TYPE_LIST: [string, ...string[]] = [
  ...new Set(Object.keys(elementRegistry)),
];

/** Forma de un tipo de element pack: "pack.Element". */
export const NAMESPACED_TYPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const typeSchema = z
  .union([z.enum(ELEMENT_TYPE_LIST), z.string().regex(NAMESPACED_TYPE_RE)])
  .describe(
    "Tipo de bloque: un ElementType core, o un element pack namespaced ('pack.Element')."
  );

export const elementNodeSchema: z.ZodType<ElementNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: typeSchema as unknown as z.ZodType<ElementNode["type"]>,
    props: z.record(z.unknown()),
    children: z.array(elementNodeSchema).optional(),
    columnSlots: z.array(z.array(elementNodeSchema)).optional(),
  })
);

/**
 * Valida TODOS los `type` de un arbol contra el catalogo resuelto. Devuelve
 * los tipos que no estan en el catalogo (core ∪ packs). Es la autoridad que
 * complemente al schema (que solo valida la forma).
 */
export function findUnknownTypes(
  nodes: ElementNode[],
  hasType: (type: string) => boolean,
  found: string[] = []
): string[] {
  for (const node of nodes) {
    if (!hasType(node.type) && !found.includes(node.type)) found.push(node.type);
    if (node.children) findUnknownTypes(node.children, hasType, found);
    for (const slot of node.columnSlots ?? []) findUnknownTypes(slot, hasType, found);
  }
  return found;
}

/**
 * Catalogo a usar en una tool: el resuelto (core ∪ packs) si se paso, o el
 * core si no -- retro-compatible con los callers/test que no lo pasan.
 */
export function toolCatalog(elementCatalog?: ResolvedCatalog): ResolvedCatalog {
  return elementCatalog ?? coreCatalog(elementRegistry, elementPalette);
}

/**
 * Chequeo de autoridad para las tools de contenido: valida los `type` de un
 * arbol (o de un nodo suelto) contra el catalogo resuelto. Devuelve el mensaje
 * de error si hay tipos fuera del catalogo, o null si todo esta permitido.
 * Complementa al schema Zod (que solo valida la FORMA, aceptando cualquier
 * string namespaced) -- aqui se decide el MEMBERSHIP real.
 */
export function checkNodeTypes(
  nodes: ElementNode[],
  catalog: ResolvedCatalog
): string | null {
  const unknown = findUnknownTypes(nodes, (t) => catalog.has(t));
  if (unknown.length === 0) return null;
  return (
    `Tipo(s) de elemento fuera del catalogo (core ∪ packs): ${unknown.join(", ")}. ` +
    `Usar list_page_components para ver los tipos validos hoy.`
  );
}
