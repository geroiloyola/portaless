// Persistencia real del Centro de Permisos sobre Cloudflare D1.
import type { PermissionGrant, PermissionSubject } from "../types";
import type { PermissionStore } from "../permission-store";

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

interface GrantRow {
  subject_type: string;
  subject_id: string;
  subject_display_name: string;
  capability_id: string;
  granted: number;
  granted_at: string;
  granted_by: string | null;
}

function rowToGrant(row: GrantRow): PermissionGrant {
  return {
    subject: {
      type: row.subject_type as PermissionSubject["type"],
      id: row.subject_id,
      displayName: row.subject_display_name,
    },
    capabilityId: row.capability_id,
    granted: row.granted === 1,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by ?? undefined,
  };
}

export class D1PermissionStore implements PermissionStore {
  constructor(private db: D1DatabaseLike) {}

  async getGrantsFor(subject: PermissionSubject): Promise<PermissionGrant[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM permission_grants WHERE subject_type = ? AND subject_id = ?")
      .bind(subject.type, subject.id)
      .all<GrantRow>();
    return results.map(rowToGrant);
  }

  async setGrant(grant: PermissionGrant): Promise<void> {
    const grantedAt = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO permission_grants
          (subject_type, subject_id, subject_display_name, capability_id, granted, granted_at, granted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject_type, subject_id, capability_id)
         DO UPDATE SET granted = excluded.granted, granted_at = excluded.granted_at, granted_by = excluded.granted_by`
      )
      .bind(
        grant.subject.type,
        grant.subject.id,
        grant.subject.displayName,
        grant.capabilityId,
        grant.granted ? 1 : 0,
        grantedAt,
        grant.grantedBy ?? null
      )
      .run();
  }

  async getAllGrants(): Promise<PermissionGrant[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM permission_grants")
      .bind()
      .all<GrantRow>();
    return results.map(rowToGrant);
  }
}
