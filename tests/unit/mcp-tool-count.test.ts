// El numero de tools MCP es un dato que ya se desincronizo una vez (7 -> 12 ->
// 14 mal contadas). Este test es la fuente de verdad: cuenta los
// `register*Tool(` en `packages/mcp-server/src/server.ts` (cada tool registrada
// llama una vez) y falla si CUALQUIER doc publica otro numero junto a la palabra
// "tools". Mismo espiritu que los tests de paridad del Plugin SDK.
//
// `node-ops.ts` y `element-node-schema.ts` son modulos auxiliares (operaciones
// sobre nodos y el schema Zod compartido), NO tools registradas: por eso el
// conteo sale de `register*Tool(`, no de la cantidad de archivos en tools/.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");

const serverSrc = readFileSync(join(root, "packages/mcp-server/src/server.ts"), "utf8");
const registered = [...serverSrc.matchAll(/register[A-Za-z]+Tool\(/g)].map((m) => m[0]);
const contextToolsSrc = readFileSync(join(root, "packages/mcp-server/src/tools/site-context.ts"), "utf8");
const contextToolCount = [...contextToolsSrc.matchAll(/server\.registerTool\(/g)].length;
const proposalToolsSrc = readFileSync(join(root, "packages/mcp-server/src/tools/revision-proposals.ts"), "utf8");
const proposalToolCount = [...proposalToolsSrc.matchAll(/server\.registerTool\(/g)].length;
const TOOL_COUNT = registered.length + contextToolCount + proposalToolCount;

// Docs que un agente o un usuario nuevo leen primero. Si uno publica
// "N (real) tools", N tiene que ser el conteo real.
const DOCS = [
  "AGENT.md",
  "AGENTS.md",
  "README.md",
  "ROADMAP.md",
  "docs/START_HERE.md",
  "docs/architecture/mcp-agents.md",
  "packages/mcp-server/README.md",
];

describe("conteo de tools MCP: server.ts es la fuente de verdad", () => {
  it("cada registro compartido/directo corresponde a una tool y el total es 19", () => {
    expect(TOOL_COUNT).toBe(19);
    // Sin duplicados: dos register de la misma tool seria un bug.
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("ningun doc publica un numero de tools distinto", () => {
    const offenders: string[] = [];
    for (const doc of DOCS) {
      const src = readFileSync(join(root, doc), "utf8");
      for (const m of src.matchAll(/(\d+)\s+(?:real\s+)?tools\b/gi)) {
        const n = Number(m[1]);
        if (n !== TOOL_COUNT) offenders.push(`${doc}: "${m[0].trim()}" (esperado ${TOOL_COUNT})`);
      }
    }
    expect(offenders, `Docs con un conteo de tools incorrecto:\n${offenders.join("\n")}`).toEqual([]);
  });
});
