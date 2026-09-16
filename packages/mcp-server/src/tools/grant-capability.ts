// Tool de escritura de mayor riesgo del mcp-server: otorga una
// capacidad a un subject (plugin, agente u otro theme) escribiendo
// directo sobre PermissionStore.setGrant() real. Requiere site:admin
// -- ver docs/architecture/mcp-agents.md, uso #2 ("Administracion del
// sitio via conversacion").
//
// Nota de diseno deliberada: esta tool puede conceder site:admin A OTRO
// subject, incluido el propio agente que la invoca si su implementacion
// de identidad se lo permitiera. No se agrega aqui una restriccion
// especial contra auto-escalada de privilegios porque PermissionStore
// no expone hoy un mecanismo para distinguir "quien concede" de "quien
// recibe" mas alla de grantedBy (String libre) -- graban recomendado en
// mcp-agents.md: la capacidad site:admin sobre un agente deberia
// tratarse como excepcional y revisarse manualmente, no delegarse a un
// flujo automatizado sin supervision humana directa en cada caso.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { PermissionSubjectType } from "../../../permissions/src/types";
import type { CapabilityId } from "../../../plugin-sandbox/src/types";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentity } from "../permissions/types";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";

const TOOL_NAME = "grant_capability";
const REQUIRED_CAPABILITY: CapabilityId = "site:admin";

const inputSchema = {
  subjectType: z.enum(["plugin", "agent", "theme"]).describe("Tipo de subject al que se le concede la capacidad."),
  subjectId: z.string().min(1).describe("Id del subject, ej. nombre del plugin o clave del agente."),
  subjectDisplayName: z.string().min(1),
  capabilityId: z.string().min(1).describe("Debe existir en capabilityRegistry de plugin-sandbox."),
};

export interface RegisterGrantCapabilityToolDeps {
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agent: AgentIdentity;
}

export function registerGrantCapabilityTool(server: McpServer, deps: RegisterGrantCapabilityToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Conceder una capacidad a un subject",
      description:
        "Otorga una capacidad (CapabilityId) a un plugin, agente o theme, escribiendo sobre el " +
        "PermissionStore real -- mismo efecto que hacerlo desde el Centro de Permisos. Requiere " +
        "'site:admin' concedida al agente que invoca esta tool. Usar con precaucion: conceder " +
        "site:admin a otro subject le da el mismo nivel de control administrativo.",
      inputSchema,
    },
    async ({ subjectType, subjectId, subjectDisplayName, capabilityId }) => {
      await requireCapability(deps.permissionStore, deps.agent, REQUIRED_CAPABILITY);

      await recordToolInvocation(deps.auditLog, deps.usageLedger, {
        agentKeyId: deps.agent.key,
        toolName: TOOL_NAME,
        capabilityId: REQUIRED_CAPABILITY,
        run: () =>
          deps.permissionStore.setGrant({
            subject: { type: subjectType as PermissionSubjectType, id: subjectId, displayName: subjectDisplayName },
            capabilityId,
            granted: true,
            grantedBy: `mcp-agent:${deps.agent.key}`,
          }),
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ granted: true, subjectId, capabilityId }, null, 2) }],
      };
    }
  );
}
