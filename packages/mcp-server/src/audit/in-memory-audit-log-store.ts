// Implementacion de referencia en memoria, mismo patron que
// InMemoryPermissionStore (packages/permissions/src/permission-store.ts).
// Un sitio en produccion deberia implementar AuditLogStore contra D1/SQLite,
// siguiendo el mismo patron factory que ya usan permissions y trust-layer.

import type { AuditLogEntry, AuditLogStore } from "./types";

export class InMemoryAuditLogStore implements AuditLogStore {
  private entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async list(sinceIso?: string): Promise<AuditLogEntry[]> {
    if (!sinceIso) return [...this.entries];
    return this.entries.filter((e) => e.timestamp >= sinceIso);
  }
}
