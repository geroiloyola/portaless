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

import { z } from "zod";
import { elementRegistry } from "../../../atomic-elements/src/elements/registry";
import type { ElementNode } from "../../../atomic-elements/src/types";

/** Tipos soportados hoy, leidos del registro. Nunca los liste a mano. */
export const ELEMENT_TYPE_LIST: [string, ...string[]] = [
  ...new Set(Object.keys(elementRegistry)),
];

export const elementNodeSchema: z.ZodType<ElementNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(ELEMENT_TYPE_LIST),
    props: z.record(z.unknown()),
    children: z.array(elementNodeSchema).optional(),
    columnSlots: z.array(z.array(elementNodeSchema)).optional(),
  })
);
