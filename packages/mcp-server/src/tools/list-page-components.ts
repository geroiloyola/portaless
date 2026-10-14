// Tool de solo lectura: enumera los bloques que el catalogo de Atomic
// Elements soporta hoy -- el core CERRADO (elementRegistry/elementPalette) +
// los element packs ABiertos (plugins, v0.0.9.11). Para que un agente
// componga paginas solo con piezas que el sistema de diseno realmente
// soporta, en vez de inventar estructura libre. Ver
// docs/architecture/mcp-agents.md, uso #1, y
// docs/architecture/element-catalog-plugins.md.
//
// El catalogo se resuelve EN TIEMPO DE CALL (no en import): los packs viven
// en DB y llegan/desaparecen despues de arrancar el proceso, asi que un enum
// de compile-time no puede verlos. La paleta core sigue derivada del registro
// -- el array NO esta hardcodeado.
//
// Devuelve ademas la metadata por tipo (displayName, icon, defaultProps,
// editableProps) que ya vivia en ElementDefinition y que un agente necesita
// para proponer props validas sin adivinar. Se omite renderHTML/renderHTMLAsync
// a proposito (son funciones del sitio) y se omite render.template del pack a
// proposito (es data de render del host, no input de un agente). El campo
// `source` ("core" | "pack") dice de donde viene cada entrada.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ResolvedCatalog } from "../../../atomic-elements/src/elements/element-pack";
import { coreCatalog } from "../../../atomic-elements/src/elements/element-pack";
import { elementRegistry, elementPalette } from "../../../atomic-elements/src/elements/registry";
import { ELEMENT_TYPE_LIST } from "./element-node-schema";

const TOOL_NAME = "list_page_components";

export interface RegisterListPageComponentsToolDeps {
  /**
   * Catalogo core ∪ packs. Opcional: sin el, se usa el core (comportamiento
   * previo a v0.0.9.11). server.ts lo resuelve en tiempo de call para que
   * los element packs instalados sean visibles para el agente.
   */
  elementCatalog?: ResolvedCatalog;
}

export function registerListPageComponentsTool(
  server: McpServer,
  deps: RegisterListPageComponentsToolDeps = {}
): void {
  const catalog = () => deps.elementCatalog ?? coreCatalog(elementRegistry, elementPalette);
  server.registerTool(
    TOOL_NAME,
    {
      title: "Listar componentes disponibles de Atomic Elements",
      description:
        "Devuelve los bloques soportados hoy para componer una pagina, con su metadata " +
        "(displayName, icon, defaultProps, editableProps) y su `source` ('core' o 'pack'). " +
        "Tipos core: " +
        ELEMENT_TYPE_LIST.join(", ") +
        ". Los tipos 'pack' (namespaced, 'paquete.Element') vienen de element packs instalados. " +
        "Usar exclusivamente estos tipos al construir el arbol `root` de un PageLayout " +
        "con create_page/update_page, y las claves de editableProps al proponer `props`.",
      inputSchema: {},
    },
    async () => {
      const resolved = catalog();
      const entries = resolved.palette();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                elementTypes: entries.map((e) => e.type),
                packTypes: resolved.packTypes(),
                elements: entries.map((entry) =>
                  entry.kind === "core"
                    ? {
                        type: entry.type,
                        source: "core",
                        displayName: entry.definition.displayName,
                        icon: entry.definition.icon,
                        defaultProps: entry.definition.defaultProps,
                        editableProps: entry.definition.editableProps,
                      }
                    : {
                        type: entry.type,
                        source: "pack",
                        packName: entry.packName,
                        displayName: entry.element.displayName,
                        icon: entry.element.icon,
                        defaultProps: entry.element.defaultProps,
                        editableProps: entry.element.editableProps,
                      }
                ),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
