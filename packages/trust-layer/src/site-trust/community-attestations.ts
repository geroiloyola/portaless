// packages/trust-layer/src/site-trust/community-attestations.ts
//
// Store APPEND-ONLY de atestaciones comunitarias firmadas (APW v1.3, ERRATA
// E-13). Reemplaza al voto anonimo como fuente que puntua: `community` es
// ahora una fuente de atestacion (5.3) firmada por un Veracier con did:apw.
//
// La unicidad es (iss, jti): 5.3 la exige POR EMISOR, no global. Reemitir
// agrega una fila, no pisa: el scoring toma la ultima por (iss, sub, cat) en
// tiempo de lectura, para que el historial no se pierda.
//
// `emitterFirstSeenIat` es el ts de la primera entrada verificada del historial
// del emisor (5.4), capturado al recibir la atestacion. NULL = no se pudo
// resolver; el emisor entonces no acredita antiguedad (fail-closed, E-13).
//
// La tabla `site_trust_community_votes` NO se toca: sigue siendo la opinion de
// visitante, visible y fuera del scoring.


export const DUPLICATE_COMMUNITY_JTI = "duplicate_community_jti";

export interface CommunityAttestation {
  iss: string;
  jti: string;
  siteId: string;
  sub: string;
  category: string;
  val: number;
  iat: number;
  jws: string;
  emitterFirstSeenIat: number | null;
  receivedAt: string;
}

export interface RecordCommunityAttestationInput {
  iss: string;
  jti: string;
  siteId: string;
  sub: string;
  category: string;
  val: number;
  iat: number;
  jws: string;
  emitterFirstSeenIat?: number | null;
  receivedAt: string;
}

export interface CommunityAttestationsStore {
  /** Persiste una atestacion. Lanza DUPLICATE_COMMUNITY_JTI si (iss, jti) ya existe. */
  record(input: RecordCommunityAttestationInput): Promise<CommunityAttestation>;
  listBySite(siteId: string): Promise<CommunityAttestation[]>;
  listByEmitter(iss: string, siteId?: string): Promise<CommunityAttestation[]>;
  has(iss: string, jti: string): Promise<boolean>;
}

export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
}

const COLUMNS = "iss, jti, site_id, sub, category, val, iat, jws, emitter_first_seen_iat, received_at";

export const COMMUNITY_ATTESTATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS community_attestations (
  iss TEXT NOT NULL,
  jti TEXT NOT NULL,
  site_id TEXT NOT NULL,
  sub TEXT NOT NULL,
  category TEXT NOT NULL,
  val INTEGER NOT NULL,
  iat INTEGER NOT NULL,
  jws TEXT NOT NULL,
  emitter_first_seen_iat INTEGER,
  received_at TEXT NOT NULL,
  PRIMARY KEY (iss, jti)
);`;

export const COMMUNITY_ATTESTATIONS_INDEXES_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_community_attestations_subject ON community_attestations(site_id, category);",
  "CREATE INDEX IF NOT EXISTS idx_community_attestations_emitter ON community_attestations(iss, iat);",
];

export class InMemoryCommunityAttestationsStore implements CommunityAttestationsStore {
  private rows = new Map<string, CommunityAttestation>();

  private key(iss: string, jti: string) {
    return `${iss}\u0000${jti}`;
  }

  async record(input: RecordCommunityAttestationInput): Promise<CommunityAttestation> {
    const key = this.key(input.iss, input.jti);
    if (this.rows.has(key)) throw new Error(DUPLICATE_COMMUNITY_JTI);
    const row: CommunityAttestation = {
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
    this.rows.set(key, row);
    return row;
  }

  async listBySite(siteId: string): Promise<CommunityAttestation[]> {
    return [...this.rows.values()].filter((r) => r.siteId === siteId).sort((a, b) => a.iat - b.iat);
  }

  async listByEmitter(iss: string, siteId?: string): Promise<CommunityAttestation[]> {
    return [...this.rows.values()]
      .filter((r) => r.iss === iss && (siteId === undefined || r.siteId === siteId))
      .sort((a, b) => a.iat - b.iat);
  }

  async has(iss: string, jti: string): Promise<boolean> {
    return this.rows.has(this.key(iss, jti));
  }
}

