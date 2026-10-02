// SiteTrustScore -- Protocol APW, v0.0.9.19. Dominio DISTINTO de
// PluginRegistryStore/PluginTrustVote (packages/plugin-sandbox/src/registry/):
// aquel califica PLUGINS instalados; este califica SITIOS completos,
// pensado para ser consultado por Protocol APW (packages/apw-resolver/,
// hoy stub) al resolver identidad via did:web -- un agente que decide si
// confiar en un sitio antes de una transaccion consulta este score como
// PRE-FILTRO, nunca como garantia. Ver docs/architecture/site-trust-score.md
// para el razonamiento completo (arquitectura de "confianza irrelevante":
// este score reduce cuanto necesitas confiar; nunca sustituye un escrow
// real para eliminar el riesgo residual a cero).
//
// 4 fuentes con semantica de ausencia distinta:
//   self          -> afirmacion declarativa del admin. Ausencia = neutral.
//   agent         -> verificacion automatizada (Web Bot Auth). `verified`
//                     explicito: false es señal NEGATIVA real (el agente
//                     intento verificar y fallo), no ausencia.
//   community     -> atestacion de visitantes humanos. Ausencia = neutral.
//   escrow_report -> ground truth de una transaccion real, reportada por
//                     un tercero de escrow (Portaless nunca custodia
//                     fondos). Ausencia = neutral (sin transacciones aun).
//
// v0.0.9.19: CommunityTrustVote agrega ipHash -- habilita rate-limiting
// server-side (ver isRateLimited). El rate-limit NO es una entidad
// separada del voto: es una consulta sobre la misma tabla de votos, no un
// store ni un write adicional. ipHash es SHA-256(ip + salt); la IP cruda
// nunca se persiste ni se expone en los tipos.
//
// APW v1.2 (5.3, ERRATA E-4): agent y escrow_report guardan el JWS completo
// de la atestacion del emisor (attestationJws) junto a la fila existente --
// no hay un store paralelo -- y su jti, unico por emisor. Las columnas se
// agregan solas (ALTER TABLE) a las bases anteriores; las filas viejas
// quedan con attestation_jws NULL (no verificables). `community` no cambia.
//
// APW v1.2 (5.2/5.3, B3, ERRATA E-5): `self` tambien guarda el JWS que firma
// el propio sitio. La fila sigue siendo upsert por categoria: guarda la
// atestacion VIGENTE; las anteriores quedan en el historial encadenado.

export type SelfTrustCategory =
  | "gdpr_compliance"
  | "privacy_policy"
  | "terms_of_service"
  | "payment_security"
  | "data_practices"
  | "contact_transparency";

export type AgentTrustCategory =
  | "https_and_headers"
  | "structured_data_quality"
  | "machine_readable_policies"
  | "content_freshness"
  | "bot_traffic_anomalies";

export type CommunityTrustCategory =
  | "perceived_trustworthiness"
  | "content_accuracy"
  | "spam_or_deceptive"
  | "responsiveness";

export type EscrowTransactionOutcome =
  | "completed_as_promised"
  | "refunded_no_delivery"
  | "disputed";

export interface SelfTrustEvaluation {
  siteId: string;
  category: SelfTrustCategory;
  declaredValue: boolean;
  evidenceUrl?: string;
  declaredBy: string;
  declaredAt: string;
  /** JWS compacto de la atestacion self firmada por el sitio (5.2/5.3). */
  attestationJws?: string;
  /** jti de esa atestacion. */
  attestationJti?: string;
}

export interface AgentTrustVerification {
  siteId: string;
  category: AgentTrustCategory;
  // false es una señal NEGATIVA real (el agente verifico y fallo) -- no
  // confundir con ausencia de fila, que es neutral (nunca se verifico).
  verified: boolean;
  detail?: Record<string, unknown>;
  agentKeyId: string;
  verifiedAt: string;
  /** JWS compacto de la atestacion firmada por el agente (5.3). */
  attestationJws?: string;
  /** jti de la atestacion: unico por agentKeyId. */
  attestationJti?: string;
}

export interface CommunityTrustVote {
  siteId: string;
  category: CommunityTrustCategory;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  voterId: string;
  // SHA-256(ip + salt) -- nunca la IP cruda. Usado solo para el
  // rate-limit de isRateLimited(); no se expone en la UI publica.
  ipHash: string;
  votedAt: string;
}

export interface EscrowTrustReport {
  siteId: string;
  transactionOutcome: EscrowTransactionOutcome;
  escrowProvider: string;
  amountCurrency?: string;
  reportedAt: string;
  /** JWS compacto de la atestacion firmada por el proveedor (5.3). */
  attestationJws?: string;
  /** jti de la atestacion: unico por escrowProvider. */
  attestationJti?: string;
}

/**
 * Snapshot combinado de las 4 fuentes para un sitio -- lo que Protocol APW
 * consultaria al resolver identidad. Deliberadamente NO calcula un unico
 * "score final": cada fuente se expone por separado para que quien
 * consuma (agente, humano, u otro sistema) decida su propia ponderacion.
 * Un promedio unico perderia justo la distincion que motiva este diseño
 * (verificacion objetiva vs. autoevaluacion vs. opinion vs. ground truth).
 */
export interface SiteTrustSnapshot {
  siteId: string;
  self: SelfTrustEvaluation[];
  agent: AgentTrustVerification[];
  community: CommunityTrustVote[];
  escrowReports: EscrowTrustReport[];
}

/** Lo lanzan recordAgentVerification / recordEscrowReport si el jti ya existe para ese emisor. */
export const DUPLICATE_ATTESTATION_JTI = "duplicate_attestation_jti";

/** Columnas nuevas para bases anteriores a E-4/E-5. En una base nueva el ALTER falla con "duplicate column" y se ignora. */
export const ATTESTATION_COLUMN_MIGRATIONS = [
  "ALTER TABLE site_trust_agent_verifications ADD COLUMN attestation_jws TEXT",
  "ALTER TABLE site_trust_agent_verifications ADD COLUMN attestation_jti TEXT",
  "ALTER TABLE site_trust_escrow_reports ADD COLUMN attestation_jws TEXT",
  "ALTER TABLE site_trust_escrow_reports ADD COLUMN attestation_jti TEXT",
  "ALTER TABLE site_trust_self_evaluations ADD COLUMN attestation_jws TEXT",
  "ALTER TABLE site_trust_self_evaluations ADD COLUMN attestation_jti TEXT",
];

export const ATTESTATION_INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_site_trust_agent_jti ON site_trust_agent_verifications(agent_key_id, attestation_jti) WHERE attestation_jti IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_site_trust_escrow_jti ON site_trust_escrow_reports(escrow_provider, attestation_jti) WHERE attestation_jti IS NOT NULL",
];

export function isDuplicateColumnError(err: unknown): boolean {
  return /duplicate column/i.test(String((err as Error)?.message));
}

export function isUniqueViolation(err: unknown): boolean {
  return /unique|constraint/i.test(String((err as Error)?.message));
}

/**
 * Contrato que debe implementar cualquier backend de persistencia --
 * mismo principio multi-proveedor que PermissionStore, PluginRegistryStore,
 * PageStore (D1 en Cloudflare, SQLite self-hosted).
 */
export interface SiteTrustScoreStore {
  getSnapshot(siteId: string): Promise<SiteTrustSnapshot>;

  recordSelfEvaluation(evaluation: SelfTrustEvaluation): Promise<void>;
  /** Lanza DUPLICATE_ATTESTATION_JTI si el jti ya existe para ese agente. */
  recordAgentVerification(verification: AgentTrustVerification): Promise<void>;
  recordCommunityVote(vote: CommunityTrustVote): Promise<CommunityTrustVote>;
  /** Lanza DUPLICATE_ATTESTATION_JTI si el jti ya existe para ese proveedor. */
  recordEscrowReport(report: EscrowTrustReport): Promise<void>;

  /**
   * true si ipHash ya registro un voto para este siteId+category dentro
   * de windowMs (default 24h) -- usado por functions/trust/[siteId]/
   * vote.js ANTES de llamar a recordCommunityVote, para que borrar
   * localStorage y generar un voterId nuevo no alcance para eludir el
   * limite (el chequeo es por IP, no por voterId).
   */
  isRateLimited(siteId: string, category: CommunityTrustCategory, ipHash: string, windowMs?: number): Promise<boolean>;
}

/**
 * Implementacion de referencia en memoria -- util para tests y desarrollo
 * local sin D1/SQLite configurado. Sigue el mismo patron de fallback que
 * los demas store-factory.ts del repo: nunca falla silenciosamente, solo
 * advierte que no persiste entre reinicios.
 */
export class InMemorySiteTrustScoreStore implements SiteTrustScoreStore {
  private selfEvals = new Map<string, SelfTrustEvaluation[]>();
  private agentVerifications = new Map<string, AgentTrustVerification[]>();
  private communityVotes = new Map<string, CommunityTrustVote[]>();
  private escrowReports = new Map<string, EscrowTrustReport[]>();

  async getSnapshot(siteId: string): Promise<SiteTrustSnapshot> {
    return {
      siteId,
      self: this.selfEvals.get(siteId) ?? [],
      agent: this.agentVerifications.get(siteId) ?? [],
      community: this.communityVotes.get(siteId) ?? [],
      escrowReports: this.escrowReports.get(siteId) ?? [],
    };
  }

  async recordSelfEvaluation(evaluation: SelfTrustEvaluation): Promise<void> {
    const list = this.selfEvals.get(evaluation.siteId) ?? [];
    const idx = list.findIndex((e) => e.category === evaluation.category);
    if (idx >= 0) list[idx] = evaluation;
    else list.push(evaluation);
    this.selfEvals.set(evaluation.siteId, list);
  }

  async recordAgentVerification(verification: AgentTrustVerification): Promise<void> {
    if (verification.attestationJti) {
      for (const rows of this.agentVerifications.values()) {
        if (rows.some((v) => v.agentKeyId === verification.agentKeyId && v.attestationJti === verification.attestationJti)) {
          throw new Error(DUPLICATE_ATTESTATION_JTI);
        }
      }
    }
    const list = this.agentVerifications.get(verification.siteId) ?? [];
    list.push(verification);
    this.agentVerifications.set(verification.siteId, list);
  }

  async recordCommunityVote(vote: CommunityTrustVote): Promise<CommunityTrustVote> {
    const list = this.communityVotes.get(vote.siteId) ?? [];
    const idx = list.findIndex((v) => v.category === vote.category && v.voterId === vote.voterId);
    if (idx >= 0) list[idx] = vote;
    else list.push(vote);
    this.communityVotes.set(vote.siteId, list);
    return vote;
  }

  async recordEscrowReport(report: EscrowTrustReport): Promise<void> {
    if (report.attestationJti) {
      for (const rows of this.escrowReports.values()) {
        if (rows.some((r) => r.escrowProvider === report.escrowProvider && r.attestationJti === report.attestationJti)) {
          throw new Error(DUPLICATE_ATTESTATION_JTI);
        }
      }
    }
    const list = this.escrowReports.get(report.siteId) ?? [];
    list.push(report);
    this.escrowReports.set(report.siteId, list);
  }

  async isRateLimited(
    siteId: string,
    category: CommunityTrustCategory,
    ipHash: string,
    windowMs = 24 * 60 * 60 * 1000
  ): Promise<boolean> {
    const list = this.communityVotes.get(siteId) ?? [];
    const cutoff = Date.now() - windowMs;
    return list.some(
      (v) => v.category === category && v.ipHash === ipHash && new Date(v.votedAt).getTime() > cutoff
    );
  }
}
