// Tool de solo lectura: enumera los tipos de bloque que Atomic Elements
// soporta hoy (packages/atomic-elements/src/types.ts, ElementType), para
// que un agente componga paginas solo con piezas que el sistema de
// diseno realmente soporta, en vez de inventar estructura libre. Ver
// docs/architecture/mcp-agents.md, uso #1.
//
// NOTA: ElementDefinition (misma fuente) sugiere que existe -- en algun
// registro no confirmado en esta sesion de trabajo -- metadata adicional
// por tipo (displayName, icon, editableProps). Este commit expone solo
// el ElementType base, que es el dato confirmado; ampliar con esa
// metadata es una mejora futura una vez se ubique ese registro.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const TOOL_NAME = "list_page_components";

const ELEMENT_TYPES = [
  "Hero", "Heading", "Paragraph", "Image", "Button", "Columns", "ProductGrid", "Spacer",
] as const;

export function registerListPageComponentsTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Listar componentes disponibles de Atomic Elements",
      description:
        "Devuelve los tipos de bloque (ElementType) soportados hoy para componer una pagina: " +
        ELEMENT_TYPES.join(", ") +
        ". Usar exclusivamente estos tipos al construir el arbol `root` de un PageLayout con create_page/update_page.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ elementTypes: ELEMENT_TYPES }, null, 2) }],
    })
  );
}
