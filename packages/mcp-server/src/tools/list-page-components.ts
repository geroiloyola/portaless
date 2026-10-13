// Tool de solo lectura: enumera los bloques que Atomic Elements soporta hoy
// (packages/atomic-elements/src/elements/registry.ts), para que un agente
// componga paginas solo con piezas que el sistema de diseno realmente
// soporta, en vez de inventar estructura libre. Ver
// docs/architecture/mcp-agents.md, uso #1.
//
// Lee elementPalette y elementRegistry en tiempo de import -- el array NO esta
// hardcodeado. Antes este archivo listaba los tipos a mano y debia actualizarse
// cada vez que se agregaba un elemento; quedo desincronizado cuando entraron
// Video/FAQ/Testimonial/Form/Gallery al registro. Derivar del registro mata esa
// clase de bug: un ElementType nuevo aparece aqui solo.
//
// Devuelve ademas la metadata por tipo (displayName, icon, defaultProps,
// editableProps) que ya vivia en ElementDefinition y que un agente necesita
// para proponer props validas sin adivinar. Ese es el "catalogo" que el MCP
// expone -- se omite renderHTML/renderHTMLAsync a proposito: son funciones de
// render del sitio, no datos que un agente deba recibir.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { elementRegistry, elementPalette } from "../../../atomic-elements/src/elements/registry";
import { ELEMENT_TYPE_LIST } from "./element-node-schema";

const TOOL_NAME = "list_page_components";

export function registerListPageComponentsTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Listar componentes disponibles de Atomic Elements",
      description:
        "Devuelve los bloques soportados hoy para componer una pagina, con su metadata " +
        "(displayName, icon, defaultProps, editableProps). Tipos: " +
        ELEMENT_TYPE_LIST.join(", ") +
        ". Usar exclusivamente estos tipos al construir el arbol `root` de un PageLayout " +
        "con create_page/update_page, y las claves de editableProps al proponer `props`.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              elementTypes: elementPalette,
              elements: elementPalette.map((type) => {
                const def = elementRegistry[type];
                return {
                  type,
                  displayName: def.displayName,
                  icon: def.icon,
                  defaultProps: def.defaultProps,
                  editableProps: def.editableProps,
                };
              }),
            },
            null,
            2
          ),
        },
      ],
    })
  );
}
