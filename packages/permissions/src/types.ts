// Tipos del Centro de Permisos. Reutiliza CapabilityId del paquete
// @portaless/plugin-sandbox como vocabulario compartido -- un permiso en
// este centro y una capacidad de un plugin sandboxeado son la misma cosa,
// vista desde dos lados (el administrador que concede, el plugin que usa).

export type PermissionSubjectType = "plugin" | "agent" | "theme";

export interface PermissionSubject {
  type: PermissionSubjectType;
  id: string;            // Nombre del plugin, keyId del agente (Trust Layer), o id del theme/skin.
  displayName: string;
  // v0.0.9.12: trustScore/trustScoreVotes son opcionales y solo se
  // completan para subjects de tipo "plugin" -- vienen de
  // PluginRegistryEntry (packages/plugin-sandbox/src/registry/plugin-registry.ts),
  // no de una votacion sobre el grant en si. Un agente o un theme no
  // tienen trustScore hoy; el campo queda undefined para esos casos, y la
  // UI (permission-center-ui.ts) no muestra nada si no esta presente.
  // Escala de origen: 0-5 (promedio de PluginTrustVote.score, 1-5 entero).
  // La UI la reescala a 0-10 para mostrarla estilo Trakt.
  trustScore?: number;
  trustScoreVotes?: number;
}

export interface PermissionGrant {
  subject: PermissionSubject;
  capabilityId: string;   // Debe existir en capabilityRegistry de plugin-sandbox.
  granted: boolean;
  grantedAt?: string;
  grantedBy?: string;     // Usuario administrador que otorgó/revocó el permiso.
}
