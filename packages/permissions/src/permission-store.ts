// Persistencia de las concesiones de permisos (que subject tiene que
// capacidad, encendida o apagada). Implementacion de referencia en
// memoria + interfaz pluggable para persistencia real (KV, D1, SQLite,
// un archivo JSON versionado en Git -- igual que el resto de Portaless).

import type { PermissionGrant, PermissionSubject } from "./types";

export interface PermissionStore {
  getGrantsFor(subject: PermissionSubject): Promise<PermissionGrant[]>;
  setGrant(grant: PermissionGrant): Promise<void>;
  getAllGrants(): Promise<PermissionGrant[]>;
}

export class InMemoryPermissionStore implements PermissionStore {
  private grants = new Map<string, PermissionGrant>();

  private key(subject: PermissionSubject, capabilityId: string): string {
    return `${subject.type}:${subject.id}:${capabilityId}`;
  }

  async getGrantsFor(subject: PermissionSubject): Promise<PermissionGrant[]> {
    return [...this.grants.values()].filter(
      (g) => g.subject.type === subject.type && g.subject.id === subject.id
    );
  }

  async setGrant(grant: PermissionGrant): Promise<void> {
    this.grants.set(this.key(grant.subject, grant.capabilityId), {
      ...grant,
      grantedAt: new Date().toISOString(),
    });
  }

  async getAllGrants(): Promise<PermissionGrant[]> {
    return [...this.grants.values()];
  }
}

/**
 * Adaptador que expone este store como PermissionResolver para
 * @portaless/plugin-sandbox, cerrando el círculo entre lo que el
 * administrador concede aquí y lo que el sandbox realmente ejecuta.
 */
export function createPermissionResolver(store: PermissionStore) {
  return {
    async getGrantedCapabilities(pluginName: string): Promise<Set<string>> {
      const grants = await store.getGrantsFor({ type: "plugin", id: pluginName, displayName: pluginName });
      return new Set(grants.filter((g) => g.granted).map((g) => g.capabilityId));
    },
  };
}
