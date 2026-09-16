// Tool de solo lectura: expone el mismo ledger publico que ya sirve
// GET /.well-known/portaless-usage-log.json, pero de forma conversacional
// para un agente MCP. Ver docs/architecture/mcp-agents.md, uso #4
// ("Consultar el Trust Layer como fuente de verdad").
//
// Deliberadamente la PRIMERA tool implementada: no requiere ninguna
// capacidad (el dato ya es publico), por lo que sirve para validar el
// cableado completo (registro sobre McpServer + recordToolInvocation)
// sin arriesgar ninguna escritura todavia.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AuditLogStore } from "../audit/types";
import { recordToolInvocation } from "../audit/record-tool-invocation";

const TOOL_NAME = "query_usage_log";

const inputSchema = {
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM")
    .optional()
    .describe("Periodo a consultar, ej. '2026-09'. Si se omite, usa el mes en curso (UTC)."),
};

function currentPeriod(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

export interface RegisterQueryUsageLogToolDeps {
  usageLedger: UsageLedgerStore;
  auditLog: AuditLogStore;
  agentKeyId: string;
}

/**
 * Registra query_usage_log sobre el servidor MCP. deps.agentKeyId debe
 * resolverse antes de esta llamada (ver packages/mcp-server/src/permissions,
 * AgentIdentity) -- en este commit se recibe ya resuelto porque el SDK de
 * MCP no expone todavia, en este paquete, un mecanismo propio de sesion
 * por llamada; los commits de tools con escritura (5-6) deben revisar si
 * el transporte usado permite identificar al agente por invocacion.
 */
export function registerQueryUsageLogTool(server: McpServer, deps: RegisterQueryUsageLogToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Consultar el ledger de uso de agentes de IA",
      description:
        "Devuelve el ledger publico de trazabilidad de agentes de IA para un periodo dado " +
        "(mismo dato que GET /.well-known/portaless-usage-log.json). Util para responder " +
        "preguntas como '¿cuantas veces se accedio este mes?' o '¿que agentes tuvieron " +
        "violaciones de politica detectadas?'.",
      inputSchema,
    },
    async ({ period }) => {
      const resolvedPeriod = period ?? currentPeriod();

      const result = await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: deps.agentKeyId,
        toolName: TOOL_NAME,
        capabilityId: null,
        run: async () => {
          const data = await deps.usageLedger.get(resolvedPeriod);
          return data ?? { period: resolvedPeriod, generatedAt: new Date().toISOString(), agents: [] };
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
