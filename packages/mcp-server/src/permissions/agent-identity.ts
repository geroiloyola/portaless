// Seam de identidad por invocacion del mcp-server (Opcion B -- ver
// AGENT.md y docs/architecture/mcp-agents.md). Hasta ahora el servidor
// resolvia UNA identidad fija desde variables de entorno al arrancar
// (Opcion A) y todo el proceso actuaba como ese unico agente, sin
// verificacion real: cualquier cliente conectado via stdio heredaba los
// mismos permisos y la auditoria no podia distinguir llamadas. Este
// modulo abstrae la resolucion para que cada tool la ejecute POR
// INVOCACION, con dos implementaciones:
//
// - createEnvAgentIdentityResolver (Opcion A): identidad fija del
//   proceso desde MCP_AGENT_KEY/MCP_AGENT_DISPLAY_NAME. Es lo unico
//   posible sobre transporte stdio -- el SDK de MCP no expone
//   authInfo ni sesion por llamada ahi.
//
// - createBearerTokenAgentIdentityResolver (Opcion B): verifica el
//   bearer token que el transporte HTTP adjunta a CADA peticion
//   (authInfo.token, ver index.ts) contra McpAgentTokenStore. Dos
//   tokens distintos son dos identidades con permisos y auditoria
//   separados; revocar un token corta ese acceso sin reiniciar nada.
//
// Ambos devuelven AgentIdentity y el resto del sistema (tools,
// requireCapability, auditoria) no distingue el transporte.

import type { AgentIdentity } from "./types";
import type { McpAgentTokenStore } from "./agent-token-store";

/** Contexto de una invocacion que el transporte puede aportar por llamada. */
export interface AgentInvocationContext {
  /** En transporte HTTP: token crudo del header Authorization: Bearer (aun NO verificado). */
  authInfo?: { token?: string } | null;
}

export type AgentIdentityResolver = (ctx?: AgentInvocationContext) => Promise<AgentIdentity>;

export type AgentIdentityErrorReason = "missing_token" | "invalid_token";

export class AgentIdentityError extends Error {
  constructor(public readonly reason: AgentIdentityErrorReason) {
    super(
      reason === "missing_token"
        ? "No llego credencial de agente en esta invocacion. El cliente MCP debe enviar el header " +
            "'Authorization: Bearer <token>' (token emitido desde /admin/api/mcp-agents)."
        : "El token de agente MCP recibido no es valido (desconocido o revocado). Un administrador " +
            "debe emitir uno nuevo desde /admin/api/mcp-agents."
    );
    this.name = "AgentIdentityError";
  }
}

/**
 * Opcion A -- identidad fija por proceso desde env. MCP_AGENT_KEY es
 * obligatoria al CONSTRUIR el resolver (fail-fast al arrancar, no en la
 * primera tool): sin identidad no se arranca. El ctx de invocacion se
 * ignora deliberadamente.
 */
export function createEnvAgentIdentityResolver(env: NodeJS.ProcessEnv = process.env): AgentIdentityResolver {
  const key = env.MCP_AGENT_KEY;
  if (!key) {
    throw new Error(
      "MCP_AGENT_KEY no esta definida. El servidor MCP de Portaless requiere una identidad de " +
        "agente (Opcion A sobre stdio, ver AGENT.md) -- defini MCP_AGENT_KEY (ej. 'ed25519:...' o " +
        "cualquier id estable) y opcionalmente MCP_AGENT_DISPLAY_NAME, o bien corre con " +
        "PORTALESS_MCP_TRANSPORT=http (Opcion B, identidad por invocacion via bearer token)."
    );
  }
  const identity: AgentIdentity = { key, displayName: env.MCP_AGENT_DISPLAY_NAME ?? key };
  return async () => identity;
}

/**
 * Opcion B -- identidad por invocacion via bearer token HTTP. Cada tool
 * llama a esta funcion ANTES de tocar datos; un token desconocido o
 * revocado lanza AgentIdentityError y queda registrado en la capa de
 * auditoria como cualquier otro fallo.
 */
export function createBearerTokenAgentIdentityResolver(
  store: McpAgentTokenStore
): AgentIdentityResolver {
  return async (ctx) => {
    const token = ctx?.authInfo?.token;
    if (!token) throw new AgentIdentityError("missing_token");
    const identity = await store.verify(token);
    if (!identity) throw new AgentIdentityError("invalid_token");
    return { key: identity.agentKeyId, displayName: identity.displayName };
  };
}

/**
 * Extrae el token crudo de un header Authorization (valor tipo
 * "Bearer <token>"). Case-insensitive en el esquema; cualquier valor
 * malformado (sin esquema, vacio, "Basic ...") devuelve null -- el
 * caller decide si eso es un 401 o un AgentIdentityError.
 */
export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headerValue);
  return match ? match[1] : null;
}
