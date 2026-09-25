// Persistencia real del registro de plugins para self-hosted.
// Mismo patron que packages/permissions/src/stores/sqlite-permission-store.ts.
//
// requestedCapabilities se guarda serializado en manifest_json, igual que
// en D1PluginRegistryStore -- ver ese archivo para el detalle de por que.
//
// v0.0.9.27: migrado de node:sqlite (require en ESM, Node 22.5+) a
// better-sqlite3 via openSqlite(). Uso: await SqlitePluginRegistryStore.open(path).

import type {
  PluginRegistryEntry,
  PluginRegistryStore,
  PluginSourceType,
  PluginTrustVote,
} from "../plugin-registry";
import type { CapabilityRequest } from "../../types";
import { openSqlite } from "../../../../sqlite-driver/src/open";

interface PluginRow {
  plugin_id: string;
  display_name: string;
  author: string;
  source_type: string;
  manifest_json: string;
  registered_at: string;
  installed_at: string | null;
  active: number;
  trust_score: number;
  trust_score_votes: number;
  audited_by: string | null;
}

function rowToEntry(row: PluginRow): PluginRegistryEntry {
  const manifest = JSON.parse(row.manifest_json) as {
    requestedCapabilities: CapabilityRequest[];
  };
  return {
    pluginId: row.plugin_id,
    displayName: row.display_name,
    author: row.author,
    sourceType: row.source_type as PluginSourceType,
    requestedCapabilities: manifest.requestedCapabilities,
    registeredAt: row.registered_at,
    installedAt: row.installed_at ?? undefined,
    active: row.active === 1,
    trustScore: row.trust_score,
    trustScoreVotes: row.trust_score_votes,
    auditedBy: row.audited_by ?? undefined,
  };
}

export class SqlitePluginRegistryStore implements PluginRegistryStore {
  private db: any;

  static async open(dbPath: string): Promise<SqlitePluginRegistryStore> {
    return new SqlitePluginRegistryStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqlitePluginRegistryStore ya no acepta una ruta en el constructor (v0.0.9.27). Usa: await SqlitePluginRegistryStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_registry (
      plugin_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      author TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('open', 'closed')),
      manifest_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      installed_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      trust_score REAL NOT NULL DEFAULT 0,
      trust_score_votes INTEGER NOT NULL DEFAULT 0,
      audited_by TEXT
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_trust_votes (
      plugin_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
      comment TEXT,
      voted_at TEXT NOT NULL,
      PRIMARY KEY (plugin_id, voter_id)
    );`);
  }

  async list(activeOnly = true): Promise<PluginRegistryEntry[]> {
    const query = activeOnly
      ? "SELECT * FROM plugin_registry WHERE active = 1"
      : "SELECT * FROM plugin_registry";
    const rows = this.db.prepare(query).all() as PluginRow[];
    return rows.map(rowToEntry);
  }

  async get(pluginId: string): Promise<PluginRegistryEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM plugin_registry WHERE plugin_id = ?")
      .get(pluginId) as PluginRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  async register(
    entry: Omit<PluginRegistryEntry, "trustScore" | "trustScoreVotes">,
  ): Promise<PluginRegistryEntry> {
    const manifestJson = JSON.stringify({
      requestedCapabilities: entry.requestedCapabilities,
    });

    this.db
      .prepare(
        `INSERT INTO plugin_registry
          (plugin_id, display_name, author, source_type, manifest_json, registered_at, installed_at, active, trust_score, trust_score_votes, audited_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(plugin_id) DO UPDATE SET
           display_name = excluded.display_name,
           author = excluded.author,
           source_type = excluded.source_type,
           manifest_json = excluded.manifest_json,
           installed_at = excluded.installed_at,
           active = excluded.active,
           audited_by = excluded.audited_by`,
      )
      .run(
        entry.pluginId,
        entry.displayName,
        entry.author,
        entry.sourceType,
        manifestJson,
        entry.registeredAt,
        entry.installedAt ?? null,
        entry.active ? 1 : 0,
        entry.auditedBy ?? null,
      );

    const saved = await this.get(entry.pluginId);
    if (!saved) {
      throw new Error(`No se pudo registrar el plugin "${entry.pluginId}".`);
    }
    return saved;
  }

  async setActive(pluginId: string, active: boolean): Promise<void> {
    const existing = await this.get(pluginId);
    if (!existing) {
      throw new Error(`Plugin "${pluginId}" no esta registrado.`);
    }
    this.db
      .prepare("UPDATE plugin_registry SET active = ? WHERE plugin_id = ?")
      .run(active ? 1 : 0, pluginId);
  }

  async recordVote(vote: PluginTrustVote): Promise<PluginRegistryEntry> {
    const existing = await this.get(vote.pluginId);
    if (!existing) {
      throw new Error(`Plugin "${vote.pluginId}" no esta registrado.`);
    }

    this.db
      .prepare(
        `INSERT INTO plugin_trust_votes (plugin_id, voter_id, score, comment, voted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(plugin_id, voter_id) DO UPDATE SET
           score = excluded.score,
           comment = excluded.comment,
           voted_at = excluded.voted_at`,
      )
      .run(vote.pluginId, vote.voterId, vote.score, vote.comment ?? null, vote.votedAt);

    const rows = this.db
      .prepare("SELECT score FROM plugin_trust_votes WHERE plugin_id = ?")
      .all(vote.pluginId) as { score: number }[];

    const total = rows.reduce((sum, v) => sum + v.score, 0);
    const trustScore = rows.length > 0 ? total / rows.length : 0;

    this.db
      .prepare("UPDATE plugin_registry SET trust_score = ?, trust_score_votes = ? WHERE plugin_id = ?")
      .run(trustScore, rows.length, vote.pluginId);

    const updated = await this.get(vote.pluginId);
    if (!updated) {
      throw new Error(`Plugin "${vote.pluginId}" no esta registrado.`);
    }
    return updated;
  }

  close(): void {
    this.db.close();
  }
}
