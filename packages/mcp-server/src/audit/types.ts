// Tipos del log de auditoria LOCAL del mcp-server. Distinto del ledger
// publico del Trust Layer (packages/trust-layer/src/ledger/log-schema.ts,
// AgentUsageEntry/UsageLogPeriod), que es un agregado mensual por agente
// sin granularidad de evento individual. Este log local SI registra cada
// invocacion por separado.

export interface AuditLogEntry {
  timestamp: string;        // ISO 8601
  agentKeyId: string;       // Mismo valor que AgentIdentity.key (permissions/types.ts)
  toolName: string;
  capabilityId: string | null; // null si la tool no requiere capacidad (ej. solo lectura publica)
  outcome: "success" | "denied" | "error";
  errorMessage?: string;
}

export interface AuditLogStore {
  append(entry: AuditLogEntry): Promise<void>;
  list(sinceIso?: string): Promise<AuditLogEntry[]>;
}
