import { openSqlite } from "@portaless/sqlite-driver";
import {
  COMMUNITY_ATTESTATIONS_INDEXES_SQL,
  COMMUNITY_ATTESTATIONS_TABLE_SQL,
  DUPLICATE_COMMUNITY_JTI,
  InMemoryCommunityAttestationsStore,
  type CommunityAttestation,
  type CommunityAttestationsStore,
  type D1DatabaseLike,
  type RecordCommunityAttestationInput,
} from "@verared/trust-layer/site-trust";
const COLUMNS = "iss, jti, site_id, sub, category, val, iat, jws, emitter_first_seen_iat, received_at";

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT") return true;
  const message = String((err as { message?: string } | null)?.message ?? "");
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT|D1_ERROR.*UNIQUE/i.test(message);
}

function rowToAttestation(row: Record<string, unknown>): CommunityAttestation {
  return {
    iss: row.iss as string,
    jti: row.jti as string,
    siteId: row.site_id as string,
    sub: row.sub as string,
    category: row.category as string,
    val: row.val as number,
    iat: row.iat as number,
    jws: row.jws as string,
    emitterFirstSeenIat: (row.emitter_first_seen_iat ?? null) as number | null,
    receivedAt: row.received_at as string,
  };
}

export class D1CommunityAttestationsStore implements CommunityAttestationsStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private db: D1DatabaseLike) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.db.prepare(COMMUNITY_ATTESTATIONS_TABLE_SQL).bind().run();
        for (const index of COMMUNITY_ATTESTATIONS_INDEXES_SQL) {
          await this.db.prepare(index).bind().run();
        }
      })();
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  async record(input: RecordCommunityAttestationInput): Promise<CommunityAttestation> {
    await this.ensureSchema();
    try {
      await this.db
        .prepare(
          `INSERT INTO community_attestations (iss, jti, site_id, sub, category, val, iat, jws, emitter_first_seen_iat, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.iss,
          input.jti,
          input.siteId,
          input.sub,
          input.category,
          input.val,
          input.iat,
          input.jws,
          input.emitterFirstSeenIat ?? null,
          input.receivedAt
        )
        .run();
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(DUPLICATE_COMMUNITY_JTI);
      throw err;
    }
    return {
      iss: input.iss,
      jti: input.jti,
      siteId: input.siteId,
      sub: input.sub,
      category: input.category,
      val: input.val,
      iat: input.iat,
      jws: input.jws,
      emitterFirstSeenIat: input.emitterFirstSeenIat ?? null,
      receivedAt: input.receivedAt,
    };
  }

  async listBySite(siteId: string): Promise<CommunityAttestation[]> {
    await this.ensureSchema();
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM community_attestations WHERE site_id = ? ORDER BY iat ASC`)
      .bind(siteId)
      .all<Record<string, unknown>>();
    return results.map(rowToAttestation);
  }

  async listByEmitter(iss: string, siteId?: string): Promise<CommunityAttestation[]> {
    await this.ensureSchema();
    const sql = siteId
      ? `SELECT ${COLUMNS} FROM community_attestations WHERE iss = ? AND site_id = ? ORDER BY iat ASC`
      : `SELECT ${COLUMNS} FROM community_attestations WHERE iss = ? ORDER BY iat ASC`;
    const statement = this.db.prepare(sql);
    const { results } = await (siteId ? statement.bind(iss, siteId) : statement.bind(iss)).all<Record<string, unknown>>();
    return results.map(rowToAttestation);
  }

  async has(iss: string, jti: string): Promise<boolean> {
    await this.ensureSchema();
    const row = await this.db
      .prepare("SELECT 1 as hit FROM community_attestations WHERE iss = ? AND jti = ?")
      .bind(iss, jti)
      .first<{ hit: number }>();
    return row !== null;
  }
}

export class SqliteCommunityAttestationsStore implements CommunityAttestationsStore {
  static async open(dbPath: string): Promise<SqliteCommunityAttestationsStore> {
    return new SqliteCommunityAttestationsStore(await openSqlite(dbPath));
  }

  constructor(private db: any) {
    this.db.exec(COMMUNITY_ATTESTATIONS_TABLE_SQL);
    for (const index of COMMUNITY_ATTESTATIONS_INDEXES_SQL) this.db.exec(index);
  }

  async record(input: RecordCommunityAttestationInput): Promise<CommunityAttestation> {
    try {
      this.db
        .prepare(
          `INSERT INTO community_attestations (iss, jti, site_id, sub, category, val, iat, jws, emitter_first_seen_iat, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.iss,
          input.jti,
          input.siteId,
          input.sub,
          input.category,
          input.val,
          input.iat,
          input.jws,
          input.emitterFirstSeenIat ?? null,
          input.receivedAt
        );
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(DUPLICATE_COMMUNITY_JTI);
      throw err;
    }
    return {
      iss: input.iss,
      jti: input.jti,
      siteId: input.siteId,
      sub: input.sub,
      category: input.category,
      val: input.val,
      iat: input.iat,
      jws: input.jws,
      emitterFirstSeenIat: input.emitterFirstSeenIat ?? null,
      receivedAt: input.receivedAt,
    };
  }

  async listBySite(siteId: string): Promise<CommunityAttestation[]> {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM community_attestations WHERE site_id = ? ORDER BY iat ASC`)
      .all(siteId)
      .map(rowToAttestation);
  }

  async listByEmitter(iss: string, siteId?: string): Promise<CommunityAttestation[]> {
    return siteId
      ? this.db
          .prepare(`SELECT ${COLUMNS} FROM community_attestations WHERE iss = ? AND site_id = ? ORDER BY iat ASC`)
          .all(iss, siteId)
          .map(rowToAttestation)
      : this.db
          .prepare(`SELECT ${COLUMNS} FROM community_attestations WHERE iss = ? ORDER BY iat ASC`)
          .all(iss)
          .map(rowToAttestation);
  }

  async has(iss: string, jti: string): Promise<boolean> {
    return this.db.prepare("SELECT 1 as hit FROM community_attestations WHERE iss = ? AND jti = ?").get(iss, jti) !== undefined;
  }
}

export interface CommunityAttestationsFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export async function createCommunityAttestationsStore(
  env: CommunityAttestationsFactoryEnv
): Promise<CommunityAttestationsStore> {
  if (env.DB) return new D1CommunityAttestationsStore(env.DB as D1DatabaseLike);
  if (env.PORTALESS_SQLITE_PATH) return SqliteCommunityAttestationsStore.open(env.PORTALESS_SQLITE_PATH);
  return new InMemoryCommunityAttestationsStore();
}

