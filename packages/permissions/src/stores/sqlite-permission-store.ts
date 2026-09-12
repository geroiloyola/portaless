// Persistencia real del Centro de Permisos para self-hosted (node:sqlite).
import type { PermissionGrant, PermissionSubject } from "../types";
import type { PermissionStore } from "../permission-store";

interface GrantRow {
  subject_type: string; subject_id: string; subject_display_name: string;
  capability_id: string; granted: number; granted_at: string; granted_by: string | null;
}

function rowToGrant(row: GrantRow): PermissionGrant {
  return {
    subject: { type: row.subject_type as PermissionSubject["type"], id: row.subject_id, displayName: row.subject_display_name },
    capabilityId: row.capability_id, granted: row.granted === 1,
    grantedAt: row.granted_at, grantedBy: row.granted_by ?? undefined,
  };
}

export class SqlitePermissionStore implements PermissionStore {
  private db: any;
  constructor(dbPath: string) {
    let DatabaseSync: any;
    try { ({ DatabaseSync } = require("node:sqlite")); }
    catch { throw new Error("node:sqlite no esta disponible. Requiere Node 22.5+."); }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS permission_grants (
      subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_display_name TEXT NOT NULL,
      capability_id TEXT NOT NULL, granted INTEGER NOT NULL, granted_at TEXT NOT NULL, granted_by TEXT,
      PRIMARY KEY (subject_type, subject_id, capability_id));`);
  }

  async getGrantsFor(subject: PermissionSubject): Promise<PermissionGrant[]> {
    const rows = this.db.prepare("SELECT * FROM permission_grants WHERE subject_type = ? AND subject_id = ?")
      .all(subject.type, subject.id) as GrantRow[];
    return rows.map(rowToGrant);
  }

  async setGrant(grant: PermissionGrant): Promise<void> {
    const grantedAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO permission_grants (subject_type, subject_id, subject_display_name, capability_id, granted, granted_at, granted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subject_type, subject_id, capability_id)
       DO UPDATE SET granted = excluded.granted, granted_at = excluded.granted_at, granted_by = excluded.granted_by`
    ).run(grant.subject.type, grant.subject.id, grant.subject.displayName, grant.capabilityId,
      grant.granted ? 1 : 0, grantedAt, grant.grantedBy ?? null);
  }

  async getAllGrants(): Promise<PermissionGrant[]> {
    const rows = this.db.prepare("SELECT * FROM permission_grants").all() as GrantRow[];
    return rows.map(rowToGrant);
  }
}
