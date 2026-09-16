// Guard central de permisos. Toda tool del mcp-server que toque datos
// reales DEBE llamar a requireCapability() antes de ejecutar su logica.
// No existe una via alternativa: esto es intencional (ver principio
// rector en docs/architecture/mcp-agents.md -- "el mcp-server no debe
// ser un atajo que le de a un agente mas poder del que tendria un
// plugin humano").

import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { CapabilityId } from "../../../plugin-sandbox/src/types";
import type { AgentIdentity } from "./types";
import { agentIdentityToSubject } from "./types";

export class CapabilityDeniedError extends Error {
  constructor(
    public readonly agent: AgentIdentity,
    public readonly capabilityId: CapabilityId
  ) {
    super(
      `Agente '${agent.displayName}' (${agent.key}) no tiene concedida la capacidad '${capabilityId}'. ` +
      `Un administrador debe otorgarla desde el Centro de Permisos antes de reintentar.`
    );
    this.name = "CapabilityDeniedError";
  }
}

/**
 * Verifica contra el PermissionStore real si `agent` tiene `capabilityId`
 * concedida. Lanza CapabilityDeniedError si no la tiene -- las tools
 * deben dejar propagar este error sin capturarlo silenciosamente, para
 * que quede visible tanto al agente como en la capa de auditoria
 * (packages/mcp-server/src/audit/, commit 3/6).
 */
export async function requireCapability(
  store: PermissionStore,
  agent: AgentIdentity,
  capabilityId: CapabilityId
): Promise<void> {
  const subject = agentIdentityToSubject(agent);
  const grants = await store.getGrantsFor(subject);
  const grant = grants.find((g) => g.capabilityId === capabilityId);

  if (!grant || !grant.granted) {
    throw new CapabilityDeniedError(agent, capabilityId);
  }
}

/**
 * Envuelve el handler de una tool para que requiera una capacidad antes
 * de ejecutarse. Uso previsto en los commits 4-6, al registrar cada
 * tool sobre el McpServer:
 *
 *   server.registerTool("create_page", schema,
 *     withCapability(store, agent, "content:write", async (args) => {...}));
 */
export function withCapability<TArgs, TResult>(
  store: PermissionStore,
  agent: AgentIdentity,
  capabilityId: CapabilityId,
  handler: (args: TArgs) => Promise<TResult>
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    await requireCapability(store, agent, capabilityId);
    return handler(args);
  };
}
