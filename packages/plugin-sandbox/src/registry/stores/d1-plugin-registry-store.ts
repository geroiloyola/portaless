// Persistencia real del registro de plugins sobre Cloudflare D1.
// Mismo patron que packages/permissions/src/stores/d1-permission-store.ts.
//
// requestedCapabilities se serializa dentro de manifest_json (columna unica
// TEXT en la tabla plugin_registry, ver schema.sql) en vez de una tabla
// aparte -- es la unica pieza de PluginRegistryEntry que no tiene columna
// propia; todo lo demas (author, sourceType, trustScore, etc.) si la tiene.

import type {
  PluginRegistryEntry,
  PluginRegistryStore,
  PluginSourceType,
  PluginTrustVote,
} from "../plugin-registry";
import type { CapabilityRequest } from "../../types";

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

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

export class D1PluginRegistryStore implements PluginRegistryStore {
  constructor(private db: D1DatabaseLike) {}

  async list(activeOnly = true): Promise<PluginRegistryEntry[]> {
    const query = activeOnly
      ? "SELECT * FROM plugin_registry WHERE active = 1"
      : "SELECT * FROM plugin_registry";
    const { results } = await this.db.prepare(query).bind().all<PluginRow>();
    return results.map(rowToEntry);
  }

  async get(pluginId: string): Promise<PluginRegistryEntry | null> {
    const row = await this.db
      .prepare("SELECT * FROM plugin_registry WHERE plugin_id = ?")
      .bind(pluginId)
      .first<PluginRow>();
    return row ? rowToEntry(row) : null;
  }

  async register(
    entry: Omit<PluginRegistryEntry, "trustScore" | "trustScoreVotes">,
  ): Promise<PluginRegistryEntry> {
    const manifestJson = JSON.stringify({
      requestedCapabilities: entry.requestedCapabilities,
    });

    await this.db
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
      .bind(
        entry.pluginId,
        entry.displayName,
        entry.author,
        entry.sourceType,
        manifestJson,
        entry.registeredAt,
        entry.installedAt ?? null,
        entry.active ? 1 : 0,
        entry.auditedBy ?? null,
      )
      .run();

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
    await this.db
      .prepare("UPDATE plugin_registry SET active = ? WHERE plugin_id = ?")
      .bind(active ? 1 : 0, pluginId)
      .run();
  }

  async recordVote(vote: PluginTrustVote): Promise<PluginRegistryEntry> {
    const existing = await this.get(vote.pluginId);
    if (!existing) {
      throw new Error(`Plugin "${vote.pluginId}" no esta registrado.`);
    }

    await this.db
      .prepare(
        `INSERT INTO plugin_trust_votes (plugin_id, voter_id, score, comment, voted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(plugin_id, voter_id) DO UPDATE SET
           score = excluded.score,
           comment = excluded.comment,
           voted_at = excluded.voted_at`,
      )
      .bind(vote.pluginId, vote.voterId, vote.score, vote.comment ?? null, vote.votedAt)
      .run();

    const { results } = await this.db
      .prepare("SELECT score FROM plugin_trust_votes WHERE plugin_id = ?")
      .bind(vote.pluginId)
      .all<{ score: number }>();

    const total = results.reduce((sum, v) => sum + v.score, 0);
    const trustScore = results.length > 0 ? total / results.length : 0;

    await this.db
      .prepare("UPDATE plugin_registry SET trust_score = ?, trust_score_votes = ? WHERE plugin_id = ?")
      .bind(trustScore, results.length, vote.pluginId)
      .run();

    const updated = await this.get(vote.pluginId);
    if (!updated) {
      throw new Error(`Plugin "${vote.pluginId}" no esta registrado.`);
    }
    return updated;
  }
}
