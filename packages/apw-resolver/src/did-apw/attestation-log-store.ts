// packages/apw-resolver/src/did-apw/attestation-log-store.ts
//
// Persistencia del historial encadenado del sitio (APW v1.2, seccion 5.4).
// Una fila por entrada: el JWS completo firmado por el sitio mas los campos
// derivados que sirven para indexar. La fuente de verdad es entry_jws: los
// verificadores recalculan hashes y firmas, nunca confian en estas columnas.
//
// Mismo patron multi-backend que SiteIdentityStore. Las tablas se crean al
// primer uso (CREATE IF NOT EXISTS).
//
// Concurrencia: la PK (site_id, seq) impide que dos escrituras bifurquen la
// cadena; la que pierde recibe LOG_SEQ_CONFLICT y appendAttestation reintenta.
// El indice unico (site_id, att_hash) impide registrar dos veces la misma
// atestacion.
//
// APW v1.2 (ERRATA E-9): att_jws guarda el JWS del emisor completo, para
// publicarlo en /.well-known/apw-attestations.json. La entrada firmada solo
// contiene su hash (att): cualquiera puede comprobar que el JWS publicado es
// el anotado recalculando SHA-256. La columna se agrega sola (ALTER TABLE) a
// las bases existentes; las entradas anteriores quedan con att_jws NULL.

import { D1Adapter, SqliteAdapter, type SqlAdapter } from './sql-adapter';

export interface AttestationLogEntry {
  siteId: string;
  seq: number;
  /** JWS compacto firmado por el sitio con payload { seq, prev, att, ts }. */
  entryJws: string;
  /** base64url(SHA-256(entryJws)). Es el `prev` de la entrada siguiente y el `h` del TXT para la ultima. */
  entryHash: string;
  prevHash: string | null;
  /** base64url(SHA-256(JWS del emisor)). */
  attHash: string;
  /** JWS del emisor (E-9). null en entradas anteriores a E-9. */
  attJws?: string | null;
  /** Huella de la clave del sitio que firmo la entrada. */
  kid: string;
  ts: string;
}

export const LOG_SEQ_CONFLICT = 'attestation_log_seq_conflict';
export const LOG_DUPLICATE_ATTESTATION = 'duplicate_attestation';

export interface AttestationLogStore {
  head(siteId: string): Promise<AttestationLogEntry | null>;
  /** Lanza LOG_SEQ_CONFLICT si la seq ya existe y LOG_DUPLICATE_ATTESTATION si att ya esta registrada. */
  append(entry: AttestationLogEntry): Promise<void>;
  /** Entradas con seq >= fromSeq, en orden ascendente. */
  list(siteId: string, fromSeq: number, limit: number): Promise<AttestationLogEntry[]>;
}

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS site_attestation_log (
    site_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    entry_jws TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    prev_hash TEXT,
    att_hash TEXT NOT NULL,
    kid TEXT NOT NULL,
    ts TEXT NOT NULL,
    att_jws TEXT,
    PRIMARY KEY (site_id, seq)
  )`;

const INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_site_attestation_log_att ON site_attestation_log(site_id, att_hash)';

/** Para bases creadas antes de E-9. En una base nueva falla con "duplicate column" y se ignora. */
export const ATTESTATION_LOG_ADD_COLUMNS = ['ALTER TABLE site_attestation_log ADD COLUMN att_jws TEXT'];

export const ATTESTATION_LOG_DDL = [TABLE_DDL, INDEX_DDL];

const COLUMNS = 'site_id, seq, entry_jws, entry_hash, prev_hash, att_hash, kid, ts, att_jws';

function rowToEntry(row: any): AttestationLogEntry {
  return {
    siteId: row.site_id,
    seq: Number(row.seq),
    entryJws: row.entry_jws,
    entryHash: row.entry_hash,
    prevHash: row.prev_hash ?? null,
    attHash: row.att_hash,
    attJws: row.att_jws ?? null,
    kid: row.kid,
    ts: row.ts,
  };
}

export class SqlAttestationLogStore implements AttestationLogStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql.run(TABLE_DDL);
        for (const alter of ATTESTATION_LOG_ADD_COLUMNS) {
          try {
            await this.sql.run(alter);
          } catch (err) {
            if (!/duplicate column/i.test(String((err as Error)?.message))) throw err;
          }
        }
        await this.sql.run(INDEX_DDL);
      })();
      this.schemaReady.catch(() => {
        this.schemaReady = null;
      });
    }
    return this.schemaReady;
  }

  async head(siteId: string): Promise<AttestationLogEntry | null> {
    await this.ensureSchema();
    const row = await this.sql.first(`SELECT ${COLUMNS} FROM site_attestation_log WHERE site_id = ? ORDER BY seq DESC LIMIT 1`, [siteId]);
    return row ? rowToEntry(row) : null;
  }

  async append(entry: AttestationLogEntry): Promise<void> {
    await this.ensureSchema();
    const duplicate = await this.sql.first('SELECT seq FROM site_attestation_log WHERE site_id = ? AND att_hash = ?', [entry.siteId, entry.attHash]);
    if (duplicate) throw new Error(LOG_DUPLICATE_ATTESTATION);
    try {
      await this.sql.run(`INSERT INTO site_attestation_log (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        entry.siteId,
        entry.seq,
        entry.entryJws,
        entry.entryHash,
        entry.prevHash,
        entry.attHash,
        entry.kid,
        entry.ts,
        entry.attJws ?? null,
      ]);
    } catch (err) {
      if (/unique|constraint/i.test(String((err as Error)?.message))) throw new Error(LOG_SEQ_CONFLICT);
      throw err;
    }
  }

  async list(siteId: string, fromSeq: number, limit: number): Promise<AttestationLogEntry[]> {
    await this.ensureSchema();
    const rows = await this.sql.all(`SELECT ${COLUMNS} FROM site_attestation_log WHERE site_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?`, [siteId, fromSeq, limit]);
    return rows.map(rowToEntry);
  }
}

export class D1AttestationLogStore extends SqlAttestationLogStore {
  constructor(db: D1Database) {
    super(new D1Adapter(db));
  }
}

export class SqliteAttestationLogStore extends SqlAttestationLogStore {
  constructor(db: { prepare: (sql: string) => any }) {
    super(new SqliteAdapter(db));
  }
}

export class InMemoryAttestationLogStore implements AttestationLogStore {
  private entries = new Map<string, AttestationLogEntry[]>();

  async head(siteId: string): Promise<AttestationLogEntry | null> {
    const list = this.entries.get(siteId);
    return list && list.length > 0 ? { ...list[list.length - 1] } : null;
  }

  async append(entry: AttestationLogEntry): Promise<void> {
    const list = this.entries.get(entry.siteId) ?? [];
    if (list.some((e) => e.attHash === entry.attHash)) throw new Error(LOG_DUPLICATE_ATTESTATION);
    if (list.some((e) => e.seq === entry.seq)) throw new Error(LOG_SEQ_CONFLICT);
    list.push({ ...entry, attJws: entry.attJws ?? null });
    list.sort((a, b) => a.seq - b.seq);
    this.entries.set(entry.siteId, list);
  }

  async list(siteId: string, fromSeq: number, limit: number): Promise<AttestationLogEntry[]> {
    return (this.entries.get(siteId) ?? []).filter((e) => e.seq >= fromSeq).slice(0, limit).map((e) => ({ ...e }));
  }
}
