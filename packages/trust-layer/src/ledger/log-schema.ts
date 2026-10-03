// Esquema del ledger publico de trazabilidad de agentes de IA.
// Publicado en "/.well-known/portaless-usage-log.json" (o servido via API
// paginada para sitios de alto trafico).
//
// Inspirado explicitamente en los paneles publicos de uso por modelo de
// OpenRouter, pero invertido: aqui se muestra cuanto usa cada agente/modelo
// de IA a ESTE sitio, no cuanto se usa un modelo en general.
//
// ERRATA E-9: readerDid es el DID APW CANDIDATO del lector, derivado del
// host de Signature-Agent (did:apw:<host>). No esta verificado: el emisor de
// reader_conduct comprueba que operatorKeyId sea `k` del TXT de ese host antes
// de firmar nada. Es publico igual que el resto del ledger.

export interface AgentUsageEntry {
  operatorKeyId: string;          // Ver AgentKeyRecord.keyId en webbotauth/key-directory.ts
  operatorNameClaimed?: string;
  readerDid?: string;             // E-9: candidato, sin verificar
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
