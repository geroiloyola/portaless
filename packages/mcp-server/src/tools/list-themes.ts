// Tool de solo lectura: enumera los temas de pagina disponibles (los
// builtin del codigo ∪ los instalados en theme_packs) con sus variables
// RESUELTAS (extends ya fusionado), para que un agente pueda elegir
// apply_theme con un nombre que existe y saber que cambia cada pack.
//
// Mismo principio que list_page_components: el catalogo NO es un enum de
// compile-time -- los instalados llegan/desaparecen de la tabla -- y la
// metadata util para componer (vars ya resueltas) se expone, mientras que
// la resolucion interna del store no. `source` distingue builtin de
// installed, igual que list_page_components distingue core de pack.
//
// Sin requireCapability: leer nombres de tema no toca contenido de la
// pagina (mismo criterio con el que list_page_components no exige capaz).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThemePack } from "../../../atomic-elements/src/themes/theme-pack";
import { BUILTIN_THEMES, resolveThemePack } from "../../../atomic-elements/src/themes/theme-pack";

const TOOL_NAME = "list_themes";

export interface RegisterListThemesToolDeps {
  /**
   * builtin ∪ instalados, ya deduplicados con availableThemes() por
   * index.ts. Opcional: sin el, se listan solo los builtins.
   */
  themes?: ThemePack[];
}

export function registerListThemesTool(server: McpServer, deps: RegisterListThemesToolDeps = {}): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Listar temas de pagina disponibles",
      description:
        "Devuelve los temas de pagina aplicables con apply_theme: nombre, displayName, " +
        "description, `source` ('builtin' o 'installed'), la cadena `extends` y las variables " +
        "CSS RESUELTAS de cada uno (solo la allowlist --accent/--bg/etc). Usar exactamente uno " +
        "de estos `name` en apply_theme; una pagina sin tema (o con un nombre que no esta aqui) " +
        "usa el skin del sitio.",
      inputSchema: {},
    },
    async () => {
      const themes = deps.themes ?? [...BUILTIN_THEMES];
      const builtinNames = new Set(BUILTIN_THEMES.map((t) => t.name));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                themes: themes.map((t) => {
                  const resolved = resolveThemePack(themes, t.name);
                  return {
                    name: t.name,
                    displayName: t.displayName,
                    description: t.description,
                    extends: t.extends,
                    source: builtinNames.has(t.name) ? "builtin" : "installed",
                    vars: resolved ? resolved.vars : t.vars,
                  };
                }),
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
