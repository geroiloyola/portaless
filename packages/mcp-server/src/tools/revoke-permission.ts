// Tool complementaria a grant_capability: revoca una capacidad ya
// concedida. Usa el mismo PermissionStore.setGrant() (granted: false),
// ya que PermissionStore no distingue "revocar" de "conceder en false"
// -- ver packages/permissions/src/permission-store.ts, setGrant() sobre-
// escribe el grant existente para la misma clave (subject.type,
// subject.id, capabilityId).

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

const TOOL_NAME = "revoke_permission";
const REQUIRED_CAPABILITY: CapabilityId = "site:admin";

const inputSchema = {
  subjectType: z.enum(["plugin", "agent", "theme"]),
  subjectId: z.string().min(1),
  subjectDisplayName: z.string().min(1),
  capabilityId: z.string().min(1),
};

export interface RegisterRevokePermissionToolDeps {
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  agent: AgentIdentity;
}

export function registerRevokePermissionTool(server: McpServer, deps: RegisterRevokePermissionToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Revocar una capacidad de un subject",
      description:
        "Revoca (granted:false) una capacidad de un plugin, agente o theme sobre el PermissionStore " +
        "real. Requiere 'site:admin' concedida al agente que invoca esta tool.",
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
            granted: false,
            grantedBy: `mcp-agent:${deps.agent.key}`,
          }),
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ granted: false, subjectId, capabilityId }, null, 2) }],
      };
    }
  );
}
