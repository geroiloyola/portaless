// Tipos de la capa de permisos del mcp-server. Reexporta/reutiliza el
// vocabulario ya definido en packages/permissions -- este paquete NO
// declara un sistema de permisos paralelo, solo lo consume.

import type { PermissionSubject } from "../../../permissions/src/types";

/**
 * Identidad cruda de un agente tal como llega al mcp-server (por
 * ejemplo, la clave publica Ed25519 usada por Web Bot Auth, o un id
 * de sesion de un cliente MCP todavia no verificado criptograficamente).
 * Ver docs/architecture/mcp-agents.md, seccion "Identidad y
 * autenticacion de agentes" -- la verificacion criptografica completa
 * via identity-atproto queda fuera del alcance de este commit.
 */
export interface AgentIdentity {
  /** Ej: "ed25519:9f2a...c31b". Debe ser estable entre invocaciones. */
  key: string;
  /** Nombre visible en el Centro de Permisos, ej. "Agente de contenido". */
  displayName: string;
}

export function agentIdentityToSubject(identity: AgentIdentity): PermissionSubject {
  return {
    type: "agent",
    id: identity.key,
    displayName: identity.displayName,
  };
}
