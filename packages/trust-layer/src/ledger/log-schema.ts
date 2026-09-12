// Esquema del ledger publico de trazabilidad de agentes de IA.
// Publicado en "/.well-known/portaless-usage-log.json" (o servido via API
// paginada para sitios de alto trafico).
//
// Inspirado explicitamente en los paneles publicos de uso por modelo de
// OpenRouter, pero invertido: aqui se muestra cuanto usa cada agente/modelo
// de IA a ESTE sitio, no cuanto se usa un modelo en general.

export interface AgentUsageEntry {
  operatorKeyId: string;          // Ver AgentKeyRecord.keyId en webbotauth/key-directory.ts
  operatorNameClaimed?: string;
  requestsTotal: number;
  requestsCharged: number;
  requestsFreeTier: number;
  revenueUsd: number;
  policyViolationsDetected: number;
  firstSeen: string;              // ISO 8601
  lastSeen: string;               // ISO 8601
}

export interface UsageLogPeriod {
  period: string;                 // Formato "YYYY-MM"
  generatedAt: string;
  agents: AgentUsageEntry[];
}
