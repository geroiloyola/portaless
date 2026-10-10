// packages/apw-resolver/src/scoring/reader-conduct-jti-store.ts
//
// Indice de jti de reader_conduct ya emitidos (ERRATA E-9 / APW v1.3, 6.4).
// El jti es determinista (conductJti): emisor, lector, periodo y categoria.
// Antes de emitir hay que saber si ese jti ya se anoto; el unico lugar que
// lo guarda "en claro" es el payload del att_jws dentro del historial, y
// inspeccionarlo requiere paginar toda la cadena. Este store lo indexa en
// una tabla aparte para que la emision AUTOMATICA (reader-conduct-auto.ts)
// pueda comprobarlo con un solo SELECT por request, sin escanear el log.
//
// La fuente de verdad sigue siendo el historial: una fila aca sin su
// atestacion anotada no emite nada. collectEmittedJtis() permite sembrar /
// reconciliar desde el log (lo usa el endpoint admin y el primer miss de la
// emision automatica en bases migradas).

import { D1Adapter, SqliteAdapter, type SqlAdapter } from '../did-apw/sql-adapter';
import type { AttestationLogStore } from '../did-apw/attestation-log-store';

export interface ReaderConductJtiRecord {
  siteId: string;
  jti: string;
  period: string;
  cat: string;
  readerDid: string;
  createdAt: string;
}

export interface ReaderConductJtiStore {
  has(siteId: string, jti: string): Promise<boolean>;
  add(record: ReaderConductJtiRecord): Promise<void>;
}

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS reader_conduct_jti (
    site_id TEXT NOT NULL,
    jti TEXT NOT NULL,
    period TEXT NOT NULL,
    cat TEXT NOT NULL,
    reader_did TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (site_id, jti)
  )`;

const COLUMNS = 'site_id, jti, period, cat, reader_did, created_at';

export class SqlReaderConductJtiStore implements ReaderConductJtiStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.sql.run(TABLE_DDL).catch((err) => {
        this.schemaReady = null;
        throw err;
      });
    }
    return this.schemaReady;
  }

  async has(siteId: string, jti: string): Promise<boolean> {
    await this.ensureSchema();
    const row = await this.sql.first(`SELECT jti FROM reader_conduct_jti WHERE site_id = ? AND jti = ?`, [siteId, jti]);
    return Boolean(row);
  }

  async add(record: ReaderConductJtiRecord): Promise<void> {
    await this.ensureSchema();
    try {
      await this.sql.run(`INSERT INTO reader_conduct_jti (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`, [
        record.siteId,
        record.jti,
        record.period,
        record.cat,
        record.readerDid,
        record.createdAt,
      ]);
    } catch (err) {
      // Reintentar la emision del mismo periodo: la fila ya existe, no es error.
      if (!/unique|constraint/i.test(String((err as Error)?.message))) throw err;
    }
  }
}

export class D1ReaderConductJtiStore extends SqlReaderConductJtiStore {
  constructor(db: D1Database) {
    super(new D1Adapter(db));
  }
}

export class SqliteReaderConductJtiStore extends SqlReaderConductJtiStore {
  constructor(db: { prepare: (sql: string) => any }) {
    super(new SqliteAdapter(db));
  }
}

export class InMemoryReaderConductJtiStore implements ReaderConductJtiStore {
  private rows = new Set<string>();

  async has(siteId: string, jti: string): Promise<boolean> {
    return this.rows.has(`${siteId}|${jti}`);
  }

  async add(record: ReaderConductJtiRecord): Promise<void> {
    this.rows.add(`${record.siteId}|${record.jti}`);
  }
}

function decodePayload(jws: string): any {
  try {
    const part = jws.split('.')[1];
    const base64 = part.split('-').join('+').split('_').join('/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

const LOG_PAGE = 500;
const MAX_PAGES = 40;

/**
 * jtis de reader_conduct ya anotados en el historial del sitio, leidos de
 * att_jws (E-9). Entradas anteriores a E-9 (sin att_jws) no se pueden
 * inspeccionar. Semilla / reconciliacion del ReaderConductJtiStore.
 */
export async function collectEmittedJtis(log: AttestationLogStore, siteId: string, siteDid: string): Promise<Set<string>> {
  const jtis = new Set<string>();
  let from = 1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await log.list(siteId, from, LOG_PAGE);
    for (const row of rows) {
      if (!row.attJws) continue;
      const p = decodePayload(row.attJws);
      if (p?.src === 'reader_conduct' && p?.iss === siteDid && typeof p.jti === 'string') jtis.add(p.jti);
    }
    if (rows.length < LOG_PAGE) return jtis;
    from = rows[rows.length - 1].seq + 1;
  }
  return jtis;
}
