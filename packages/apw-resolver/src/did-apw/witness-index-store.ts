// packages/apw-resolver/src/did-apw/witness-index-store.ts
//
// Estado del Portaless Index -- agregador de testigos (APW v1.3, 5.7 y
// seccion 7). Cinco tablas, un solo store:
//
//   witness_observations   observaciones ancladas que este nodo recopilo de
//                          los testigos configurados, por sujeto. PK
//                          (site_id, subject_did, witness_did, observed_seq):
//                          la ultima observacion anclada de cada testigo para
//                          cada seq del sujeto; una re-observacion con un
//                          anchored_ts menor no pisa la mayor (un testigo no
//                          puede "olvidar" lo que ya anclo).
//   witness_weights        ponderacion BASE por testigo (default 1.0 en
//                          quien evalua), editable por el operador. Es un
//                          multiplicador sobre el factor de calibracion.
//   witness_calibration    contadores acuerdo/desacuerdo de cada testigo con
//                          el consenso (calibracion estilo A.4.4 para el
//                          Index, ver witness-index.ts: un testigo gana
//                          peso acertando con el consenso y lo pierde
//                          disintiendo; los efectivos se recomputan en cada
//                          sync, no al publicar).
//   witness_index_subjects ultima entrada de directorio computada por
//                          syncWitnessIndex, cacheada ahi para publicar
//                          /.well-known/apw-index.json sin re-bajar cadenas
//                          en cada request. El directorio refleja la ultima
//                          sincronizacion; los pesos se recomputan en cada
//                          sync, no al publicar.
//   witness_index_peers    otros nodos indice configurados por el operador
//                          (sincronizacion entre nodos: syncIndexPeers baja
//                          su apw-index.json y usa sus entradas como
//                          DESCUBRIMIENTO de sujetos/testigos, re-verificando
//                          todo localmente -- un par nunca inyecta
//                          observaciones sin verificar).
//
// Los stores crean sus tablas al vuelo (mismo DDL que schema.sql).

import { D1Adapter, SqliteAdapter, type SqlAdapter } from './sql-adapter';

export const INVALID_WITNESS_WEIGHT = 'invalid_witness_weight';
/** Peso maximo aceptado por testigo. */
export const MAX_WITNESS_WEIGHT = 1000;

export interface WitnessObservationRecord {
  siteId: string;
  /** did:apw:<dominio observado> */
  subjectDid: string;
  /** did:apw:<dominio del testigo> */
  witnessDid: string;
  /** Longitud observada de la cadena del sujeto. */
  observedSeq: number;
  /** Hash observado de esa entrada (null si seq = 0). */
  observedHead: string | null;
  /** ts firmado de la entrada del historial DEL TESTIGO donde se anoto: su fecha creible. */
  anchoredTs: string;
  /** jti determinista del statement (wt-<hash>): identifica la observacion. */
  statementJti: string;
  updatedAt: string;
}

export interface WitnessSubjectEntryRecord {
  siteId: string;
  subjectDid: string;
  domain: string;
  /** SubjectIndexEntry serializado (ver witness-index.ts). */
  entryJson: string;
  updatedAt: string;
}

export type UpsertObservationOutcome = 'inserted' | 'updated' | 'kept';

export interface WitnessCalibrationRecord {
  siteId: string;
  /** did:apw:<dominio del testigo> */
  witnessDid: string;
  /** Sincronizaciones en las que el testigo coincidio con el consenso. */
  agree: number;
  /** Sincronizaciones en las que el testigo disintio del consenso (tuvo observacion en su seq). */
  disagree: number;
  updatedAt: string;
}

export type PeerSyncStatus = 'ok' | 'peer_unreachable' | 'peer_invalid' | 'never_synced';

export interface IndexPeerRecord {
  siteId: string;
  /** hostname del nodo par (sin esquema). */
  peerDomain: string;
  /** did:apw:<dominio> declarado en el apw-index.json del par (null si nunca se pudo leer). */
  peerDid: string | null;
  addedAt: string;
  lastSyncAt: string | null;
  lastStatus: PeerSyncStatus;
  lastSubjectsCount: number;
}

export interface WitnessIndexStore {
  setWeight(siteId: string, witnessDid: string, weight: number): Promise<void>;
  getWeights(siteId: string): Promise<Record<string, number>>;
  /** Devuelve 'kept' si ya existe una observacion con anchored_ts mayor para ese (testigo, seq). */
  upsertObservation(rec: WitnessObservationRecord): Promise<UpsertObservationOutcome>;
  listObservations(siteId: string, subjectDid: string): Promise<WitnessObservationRecord[]>;
  saveSubjectEntry(rec: WitnessSubjectEntryRecord): Promise<void>;
  getSubjectEntry(siteId: string, subjectDid: string): Promise<WitnessSubjectEntryRecord | null>;
  listSubjectEntries(siteId: string): Promise<WitnessSubjectEntryRecord[]>;
  /** Suma 1 al contador acuerdo/desacuerdo del testigo (calibracion A.4.4). */
  recordCalibration(siteId: string, witnessDid: string, agreed: boolean): Promise<void>;
  getCalibration(siteId: string): Promise<Record<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>>>;
  addPeer(rec: Omit<IndexPeerRecord, 'lastSyncAt' | 'lastStatus' | 'lastSubjectsCount'>): Promise<void>;
  removePeer(siteId: string, peerDomain: string): Promise<boolean>;
  listPeers(siteId: string): Promise<IndexPeerRecord[]>;
  updatePeerStatus(siteId: string, peerDomain: string, status: PeerSyncStatus, subjectsCount: number, peerDid: string | null): Promise<void>;
}

export function assertWitnessWeight(weight: number): void {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > MAX_WITNESS_WEIGHT) {
    throw new Error(INVALID_WITNESS_WEIGHT);
  }
}

const OBSERVATIONS_DDL = `CREATE TABLE IF NOT EXISTS witness_observations (
    site_id TEXT NOT NULL,
    subject_did TEXT NOT NULL,
    witness_did TEXT NOT NULL,
    observed_seq INTEGER NOT NULL,
    observed_head TEXT,
    anchored_ts TEXT NOT NULL,
    statement_jti TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, subject_did, witness_did, observed_seq)
  )`;

const WEIGHTS_DDL = `CREATE TABLE IF NOT EXISTS witness_weights (
    site_id TEXT NOT NULL,
    witness_did TEXT NOT NULL,
    weight REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, witness_did)
  )`;

const SUBJECTS_DDL = `CREATE TABLE IF NOT EXISTS witness_index_subjects (
    site_id TEXT NOT NULL,
    subject_did TEXT NOT NULL,
    domain TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, subject_did)
  )`;

const CALIBRATION_DDL = `CREATE TABLE IF NOT EXISTS witness_calibration (
    site_id TEXT NOT NULL,
    witness_did TEXT NOT NULL,
    agree INTEGER NOT NULL DEFAULT 0,
    disagree INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, witness_did)
  )`;

const PEERS_DDL = `CREATE TABLE IF NOT EXISTS witness_index_peers (
    site_id TEXT NOT NULL,
    peer_domain TEXT NOT NULL,
    peer_did TEXT,
    added_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_status TEXT NOT NULL DEFAULT 'never_synced',
    last_subjects_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, peer_domain)
  )`;

interface ObservationRow {
  subject_did: string;
  witness_did: string;
  observed_seq: number;
  observed_head: string | null;
  anchored_ts: string;
  statement_jti: string;
  updated_at: string;
}

function toObservationRecord(siteId: string, row: ObservationRow): WitnessObservationRecord {
  return {
    siteId,
    subjectDid: row.subject_did,
    witnessDid: row.witness_did,
    observedSeq: row.observed_seq,
    observedHead: row.observed_head ?? null,
    anchoredTs: row.anchored_ts,
    statementJti: row.statement_jti,
    updatedAt: row.updated_at,
  };
}

export class SqlWitnessIndexStore implements WitnessIndexStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly sql: SqlAdapter) {}

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = Promise.all([this.sql.run(OBSERVATIONS_DDL), this.sql.run(WEIGHTS_DDL), this.sql.run(SUBJECTS_DDL), this.sql.run(CALIBRATION_DDL), this.sql.run(PEERS_DDL)])
        .then(() => undefined)
        .catch((err) => {
          this.schemaReady = null;
          throw err;
        });
    }
    return this.schemaReady;
  }

  async setWeight(siteId: string, witnessDid: string, weight: number): Promise<void> {
    assertWitnessWeight(weight);
    await this.ensureSchema();
    await this.sql.run(
      `INSERT INTO witness_weights (site_id, witness_did, weight, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(site_id, witness_did) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
      [siteId, witnessDid, weight, new Date().toISOString()]
    );
  }

  async getWeights(siteId: string): Promise<Record<string, number>> {
    await this.ensureSchema();
    const rows = await this.sql.all<{ witness_did: string; weight: number }>(
      `SELECT witness_did, weight FROM witness_weights WHERE site_id = ?`,
      [siteId]
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[row.witness_did] = row.weight;
    return out;
  }

  async upsertObservation(rec: WitnessObservationRecord): Promise<UpsertObservationOutcome> {
    await this.ensureSchema();
    const existing = await this.sql.first<{ anchored_ts: string }>(
      `SELECT anchored_ts FROM witness_observations
       WHERE site_id = ? AND subject_did = ? AND witness_did = ? AND observed_seq = ?`,
      [rec.siteId, rec.subjectDid, rec.witnessDid, rec.observedSeq]
    );
    if (existing && existing.anchored_ts > rec.anchoredTs) return 'kept';
    if (existing) {
      await this.sql.run(
        `UPDATE witness_observations SET observed_head = ?, anchored_ts = ?, statement_jti = ?, updated_at = ?
         WHERE site_id = ? AND subject_did = ? AND witness_did = ? AND observed_seq = ?`,
        [rec.observedHead, rec.anchoredTs, rec.statementJti, rec.updatedAt, rec.siteId, rec.subjectDid, rec.witnessDid, rec.observedSeq]
      );
      return 'updated';
    }
    try {
      await this.sql.run(
        `INSERT INTO witness_observations
         (site_id, subject_did, witness_did, observed_seq, observed_head, anchored_ts, statement_jti, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [rec.siteId, rec.subjectDid, rec.witnessDid, rec.observedSeq, rec.observedHead, rec.anchoredTs, rec.statementJti, rec.updatedAt]
      );
      return 'inserted';
    } catch (err) {
      // Escritura concurrente del mismo (testigo, seq): gana la mayor; si es
      // la otra la mayor ya quedo, y si es menor esta la conserva.
      if (/unique|constraint/i.test(String((err as Error)?.message))) return 'kept';
      throw err;
    }
  }

  async listObservations(siteId: string, subjectDid: string): Promise<WitnessObservationRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql.all<ObservationRow>(
      `SELECT subject_did, witness_did, observed_seq, observed_head, anchored_ts, statement_jti, updated_at
       FROM witness_observations WHERE site_id = ? AND subject_did = ?
       ORDER BY witness_did, observed_seq`,
      [siteId, subjectDid]
    );
    return rows.map((row) => toObservationRecord(siteId, row));
  }

  async saveSubjectEntry(rec: WitnessSubjectEntryRecord): Promise<void> {
    await this.ensureSchema();
    await this.sql.run(
      `INSERT INTO witness_index_subjects (site_id, subject_did, domain, entry_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(site_id, subject_did) DO UPDATE SET domain = excluded.domain, entry_json = excluded.entry_json, updated_at = excluded.updated_at`,
      [rec.siteId, rec.subjectDid, rec.domain, rec.entryJson, rec.updatedAt]
    );
  }

  async getSubjectEntry(siteId: string, subjectDid: string): Promise<WitnessSubjectEntryRecord | null> {
    await this.ensureSchema();
    const row = await this.sql.first<{ subject_did: string; domain: string; entry_json: string; updated_at: string }>(
      `SELECT subject_did, domain, entry_json, updated_at FROM witness_index_subjects WHERE site_id = ? AND subject_did = ?`,
      [siteId, subjectDid]
    );
    if (!row) return null;
    return { siteId, subjectDid: row.subject_did, domain: row.domain, entryJson: row.entry_json, updatedAt: row.updated_at };
  }

  async listSubjectEntries(siteId: string): Promise<WitnessSubjectEntryRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql.all<{ subject_did: string; domain: string; entry_json: string; updated_at: string }>(
      `SELECT subject_did, domain, entry_json, updated_at FROM witness_index_subjects WHERE site_id = ? ORDER BY subject_did`,
      [siteId]
    );
    return rows.map((row) => ({ siteId, subjectDid: row.subject_did, domain: row.domain, entryJson: row.entry_json, updatedAt: row.updated_at }));
  }

  async recordCalibration(siteId: string, witnessDid: string, agreed: boolean): Promise<void> {
    await this.ensureSchema();
    await this.sql.run(
      `INSERT INTO witness_calibration (site_id, witness_did, agree, disagree, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(site_id, witness_did) DO UPDATE SET
         agree = witness_calibration.agree + excluded.agree,
         disagree = witness_calibration.disagree + excluded.disagree,
         updated_at = excluded.updated_at`,
      [siteId, witnessDid, agreed ? 1 : 0, agreed ? 0 : 1, new Date().toISOString()]
    );
  }

  async getCalibration(siteId: string): Promise<Record<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>>> {
    await this.ensureSchema();
    const rows = await this.sql.all<{ witness_did: string; agree: number; disagree: number }>(
      `SELECT witness_did, agree, disagree FROM witness_calibration WHERE site_id = ?`,
      [siteId]
    );
    const out: Record<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>> = {};
    for (const row of rows) out[row.witness_did] = { agree: row.agree, disagree: row.disagree };
    return out;
  }

  async addPeer(rec: Omit<IndexPeerRecord, 'lastSyncAt' | 'lastStatus' | 'lastSubjectsCount'>): Promise<void> {
    await this.ensureSchema();
    await this.sql.run(
      `INSERT INTO witness_index_peers (site_id, peer_domain, peer_did, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(site_id, peer_domain) DO UPDATE SET peer_did = excluded.peer_did`,
      [rec.siteId, rec.peerDomain, rec.peerDid, rec.addedAt]
    );
  }

  async removePeer(siteId: string, peerDomain: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.sql.first<{ peer_domain: string }>(
      `SELECT peer_domain FROM witness_index_peers WHERE site_id = ? AND peer_domain = ?`,
      [siteId, peerDomain]
    );
    if (!existing) return false;
    await this.sql.run(`DELETE FROM witness_index_peers WHERE site_id = ? AND peer_domain = ?`, [siteId, peerDomain]);
    return true;
  }

  async listPeers(siteId: string): Promise<IndexPeerRecord[]> {
    await this.ensureSchema();
    const rows = await this.sql.all<{
      peer_domain: string;
      peer_did: string | null;
      added_at: string;
      last_sync_at: string | null;
      last_status: string;
      last_subjects_count: number;
    }>(
      `SELECT peer_domain, peer_did, added_at, last_sync_at, last_status, last_subjects_count FROM witness_index_peers WHERE site_id = ? ORDER BY peer_domain`,
      [siteId]
    );
    return rows.map((row) => ({
      siteId,
      peerDomain: row.peer_domain,
      peerDid: row.peer_did,
      addedAt: row.added_at,
      lastSyncAt: row.last_sync_at,
      lastStatus: (row.last_status as PeerSyncStatus) ?? 'never_synced',
      lastSubjectsCount: row.last_subjects_count,
    }));
  }

  async updatePeerStatus(siteId: string, peerDomain: string, status: PeerSyncStatus, subjectsCount: number, peerDid: string | null): Promise<void> {
    await this.ensureSchema();
    await this.sql.run(
      `UPDATE witness_index_peers SET last_sync_at = ?, last_status = ?, last_subjects_count = ?, peer_did = ? WHERE site_id = ? AND peer_domain = ?`,
      [new Date().toISOString(), status, subjectsCount, peerDid, siteId, peerDomain]
    );
  }
}

export class D1WitnessIndexStore extends SqlWitnessIndexStore {
  constructor(db: D1Database) {
    super(new D1Adapter(db));
  }
}

export class SqliteWitnessIndexStore extends SqlWitnessIndexStore {
  constructor(db: { prepare: (sql: string) => any }) {
    super(new SqliteAdapter(db));
  }
}

export class InMemoryWitnessIndexStore implements WitnessIndexStore {
  private weights = new Map<string, number>();
  private observations = new Map<string, WitnessObservationRecord>();
  private subjects = new Map<string, WitnessSubjectEntryRecord>();
  private calibration = new Map<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>>();
  private peers = new Map<string, IndexPeerRecord>();

  private obsKey(siteId: string, subjectDid: string, witnessDid: string, seq: number): string {
    return `${siteId}|${subjectDid}|${witnessDid}|${seq}`;
  }

  async setWeight(siteId: string, witnessDid: string, weight: number): Promise<void> {
    assertWitnessWeight(weight);
    this.weights.set(`${siteId}|${witnessDid}`, weight);
  }

  async getWeights(siteId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [key, weight] of this.weights) {
      const [sid, did] = key.split('|');
      if (sid === siteId) out[did] = weight;
    }
    return out;
  }

  async upsertObservation(rec: WitnessObservationRecord): Promise<UpsertObservationOutcome> {
    const key = this.obsKey(rec.siteId, rec.subjectDid, rec.witnessDid, rec.observedSeq);
    const existing = this.observations.get(key);
    if (existing && existing.anchoredTs > rec.anchoredTs) return 'kept';
    this.observations.set(key, rec);
    return existing ? 'updated' : 'inserted';
  }

  async listObservations(siteId: string, subjectDid: string): Promise<WitnessObservationRecord[]> {
    return [...this.observations.values()]
      .filter((r) => r.siteId === siteId && r.subjectDid === subjectDid)
      .sort((a, b) => (a.witnessDid === b.witnessDid ? a.observedSeq - b.observedSeq : a.witnessDid < b.witnessDid ? -1 : 1));
  }

  async saveSubjectEntry(rec: WitnessSubjectEntryRecord): Promise<void> {
    this.subjects.set(`${rec.siteId}|${rec.subjectDid}`, rec);
  }

  async getSubjectEntry(siteId: string, subjectDid: string): Promise<WitnessSubjectEntryRecord | null> {
    return this.subjects.get(`${siteId}|${subjectDid}`) ?? null;
  }

  async listSubjectEntries(siteId: string): Promise<WitnessSubjectEntryRecord[]> {
    return [...this.subjects.values()].filter((r) => r.siteId === siteId).sort((a, b) => (a.subjectDid < b.subjectDid ? -1 : 1));
  }

  async recordCalibration(siteId: string, witnessDid: string, agreed: boolean): Promise<void> {
    const key = `${siteId}|${witnessDid}`;
    const cur = this.calibration.get(key) ?? { agree: 0, disagree: 0 };
    if (agreed) cur.agree += 1;
    else cur.disagree += 1;
    this.calibration.set(key, cur);
  }

  async getCalibration(siteId: string): Promise<Record<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>>> {
    const out: Record<string, Pick<WitnessCalibrationRecord, 'agree' | 'disagree'>> = {};
    for (const [key, counts] of this.calibration) {
      const [sid, did] = key.split('|');
      if (sid === siteId) out[did] = { ...counts };
    }
    return out;
  }

  async addPeer(rec: Omit<IndexPeerRecord, 'lastSyncAt' | 'lastStatus' | 'lastSubjectsCount'>): Promise<void> {
    const existing = this.peers.get(`${rec.siteId}|${rec.peerDomain}`);
    this.peers.set(`${rec.siteId}|${rec.peerDomain}`, {
      ...rec,
      peerDid: rec.peerDid ?? existing?.peerDid ?? null,
      addedAt: existing?.addedAt ?? rec.addedAt,
      lastSyncAt: existing?.lastSyncAt ?? null,
      lastStatus: existing?.lastStatus ?? 'never_synced',
      lastSubjectsCount: existing?.lastSubjectsCount ?? 0,
    });
  }

  async removePeer(siteId: string, peerDomain: string): Promise<boolean> {
    return this.peers.delete(`${siteId}|${peerDomain}`);
  }

  async listPeers(siteId: string): Promise<IndexPeerRecord[]> {
    return [...this.peers.values()].filter((r) => r.siteId === siteId).sort((a, b) => (a.peerDomain < b.peerDomain ? -1 : 1));
  }

  async updatePeerStatus(siteId: string, peerDomain: string, status: PeerSyncStatus, subjectsCount: number, peerDid: string | null): Promise<void> {
    const peer = this.peers.get(`${siteId}|${peerDomain}`);
    if (!peer) return;
    peer.lastSyncAt = new Date().toISOString();
    peer.lastStatus = status;
    peer.lastSubjectsCount = subjectsCount;
    peer.peerDid = peerDid ?? peer.peerDid;
  }
}
