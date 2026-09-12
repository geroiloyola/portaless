// Escritura de entradas al ledger publico de uso.
//
// Implementacion de referencia sobre almacenamiento clave-valor (compatible
// con Cloudflare KV / Durable Objects / D1). Para el MVP se deja una
// implementacion en memoria + interfaz de persistencia intercambiable.
//
// Nota de diseño: cada entrada deberia idealmente firmarse y, en una version
// futura, anclarse a un log tipo Certificate Transparency para volverla
// resistente a modificacion retroactiva -- ver Portaless_Trust_Layer.md,
// seccion 3.1, para el razonamiento legal detras de esta decision.

import type { AgentUsageEntry, UsageLogPeriod } from "./log-schema";

export interface UsageLedgerStore {
  get(period: string): Promise<UsageLogPeriod | null>;
  put(period: string, data: UsageLogPeriod): Promise<void>;
}

export class InMemoryUsageLedgerStore implements UsageLedgerStore {
  private data = new Map<string, UsageLogPeriod>();

  async get(period: string) {
    return this.data.get(period) ?? null;
  }

  async put(period: string, value: UsageLogPeriod) {
    this.data.set(period, value);
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function recordAgentAccess(
  store: UsageLedgerStore,
  params: {
    operatorKeyId: string;
    operatorNameClaimed?: string;
    charged: boolean;
    amountUsd: number;
    policyViolation?: boolean;
  }
): Promise<void> {
  const period = currentPeriod();
  const existing = (await store.get(period)) ?? {
    period,
    generatedAt: new Date().toISOString(),
    agents: [],
  };

  const nowIso = new Date().toISOString();
  let entry = existing.agents.find((a) => a.operatorKeyId === params.operatorKeyId);

  if (!entry) {
    entry = {
      operatorKeyId: params.operatorKeyId,
      operatorNameClaimed: params.operatorNameClaimed,
      requestsTotal: 0,
      requestsCharged: 0,
      requestsFreeTier: 0,
      revenueUsd: 0,
      policyViolationsDetected: 0,
      firstSeen: nowIso,
      lastSeen: nowIso,
    };
    existing.agents.push(entry);
  }

  entry.requestsTotal += 1;
  entry.lastSeen = nowIso;
  if (params.charged) {
    entry.requestsCharged += 1;
    entry.revenueUsd += params.amountUsd;
  } else {
    entry.requestsFreeTier += 1;
  }
  if (params.policyViolation) {
    entry.policyViolationsDetected += 1;
  }

  existing.generatedAt = nowIso;
  await store.put(period, existing);
}
