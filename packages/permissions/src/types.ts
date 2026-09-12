// Tipos del Centro de Permisos. Reutiliza CapabilityId del paquete
// @portaless/plugin-sandbox como vocabulario compartido -- un permiso en
// este centro y una capacidad de un plugin sandboxeado son la misma cosa,
// vista desde dos lados (el administrador que concede, el plugin que usa).

export type PermissionSubjectType = "plugin" | "agent" | "theme";

export interface PermissionSubject {
  type: PermissionSubjectType;
  id: string;            // Nombre del plugin, keyId del agente (Trust Layer), o id del theme/skin.
  displayName: string;
}

export interface PermissionGrant {
  subject: PermissionSubject;
  capabilityId: string;   // Debe existir en capabilityRegistry de plugin-sandbox.
  granted: boolean;
  grantedAt?: string;
  grantedBy?: string;     // Usuario administrador que otorgó/revocó el permiso.
}
