// SiteTrustScore -- Protocol APW, v0.0.9.14. Dominio DISTINTO de
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
}

export interface CommunityTrustVote {
  siteId: string;
  category: CommunityTrustCategory;
  score: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  voterId: string;
  votedAt: string;
}

export interface EscrowTrustReport {
  siteId: string;
  transactionOutcome: EscrowTransactionOutcome;
  escrowProvider: string;
  amountCurrency?: string;
  reportedAt: string;
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

/**
 * Contrato que debe implementar cualquier backend de persistencia --
 * mismo principio multi-proveedor que PermissionStore, PluginRegistryStore,
 * PageStore (D1 en Cloudflare, SQLite self-hosted).
 */
export interface SiteTrustScoreStore {
  getSnapshot(siteId: string): Promise<SiteTrustSnapshot>;

  recordSelfEvaluation(evaluation: SelfTrustEvaluation): Promise<void>;
  recordAgentVerification(verification: AgentTrustVerification): Promise<void>;
  recordCommunityVote(vote: CommunityTrustVote): Promise<CommunityTrustVote>;
  recordEscrowReport(report: EscrowTrustReport): Promise<void>;
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
    const list = this.escrowReports.get(report.siteId) ?? [];
    list.push(report);
    this.escrowReports.set(report.siteId, list);
  }
}
