// Punto unico donde una invocacion de tool queda registrada, en dos
// lugares a la vez:
// 1. AuditLogStore local (detalle por evento, ver types.ts).
// 2. UsageLedgerStore real de trust-layer (agregado mensual por agente,
//    packages/trust-layer/src/ledger/log-schema.ts) -- SOLO incrementando
//    contadores del periodo actual, nunca reemplazando el periodo entero,
//    para no pisar datos ya escritos por otras fuentes (ej. Web Bot Auth).

import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentUsageEntry, UsageLogPeriod } from "../../../trust-layer/src/ledger/log-schema";
import type { AuditLogEntry, AuditLogStore } from "./types";
import { CapabilityDeniedError } from "../permissions/require-capability";

function currentPeriod(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

function blankAgentEntry(operatorKeyId: string, nowIso: string): AgentUsageEntry {
  return {
    operatorKeyId,
    requestsTotal: 0,
    requestsCharged: 0,
    requestsFreeTier: 0,
    revenueUsd: 0,
    policyViolationsDetected: 0,
    firstSeen: nowIso,
    lastSeen: nowIso,
  };
}

async function incrementUsageLedger(
  ledger: UsageLedgerStore,
  agentKeyId: string,
  isViolation: boolean
): Promise<void> {
  const period = currentPeriod();
  const nowIso = new Date().toISOString();
  const existing = await ledger.get(period);

  const periodData: UsageLogPeriod = existing ?? {
    period,
    generatedAt: nowIso,
    agents: [],
  };

  let entry = periodData.agents.find((a) => a.operatorKeyId === agentKeyId);
  if (!entry) {
    entry = blankAgentEntry(agentKeyId, nowIso);
    periodData.agents.push(entry);
  }

  entry.requestsTotal += 1;
  entry.requestsFreeTier += 1; // El mcp-server no cobra por uso todavia -- ver "cuota de tokens" en docs/architecture/mcp-agents.md
  entry.lastSeen = nowIso;
  if (isViolation) entry.policyViolationsDetected += 1;

  periodData.generatedAt = nowIso;
  await ledger.put(period, periodData);
}

export interface RecordToolInvocationInput {
  agentKeyId: string;
  toolName: string;
  capabilityId: string | null;
  run: () => Promise<unknown>;
}

/**
 * Ejecuta `run()`, registrando el resultado en AuditLogStore (detalle) y
 * en UsageLedgerStore (agregado mensual real del Trust Layer). Las tools
 * de los commits 4-6 deben pasar su logica a traves de esta funcion, NO
 * llamar a los stores por separado -- para que ninguna invocacion quede
 * sin auditar por un olvido puntual.
 */
export async function recordToolInvocation(
  auditLog: AuditLogStore,
  usageLedger: UsageLedgerStore,
  input: RecordToolInvocationInput
): Promise<unknown> {
  const timestamp = new Date().toISOString();
  try {
    const result = await input.run();
    await auditLog.append({
      timestamp,
      agentKeyId: input.agentKeyId,
      toolName: input.toolName,
      capabilityId: input.capabilityId,
      outcome: "success",
    });
    await incrementUsageLedger(usageLedger, input.agentKeyId, false);
    return result;
  } catch (err) {
    const isDenied = err instanceof CapabilityDeniedError;
    const entry: AuditLogEntry = {
      timestamp,
      agentKeyId: input.agentKeyId,
      toolName: input.toolName,
      capabilityId: input.capabilityId,
      outcome: isDenied ? "denied" : "error",
      errorMessage: (err as Error).message,
    };
    await auditLog.append(entry);
    await incrementUsageLedger(usageLedger, input.agentKeyId, isDenied);
    throw err;
  }
}
