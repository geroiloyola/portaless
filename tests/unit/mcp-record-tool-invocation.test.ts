// packages/mcp-server/src/audit/record-tool-invocation.ts (29 lineas a
// 0%): el punto unico de auditoria de invocaciones de tools del MCP
// server. Se prueban los cuatro caminos (exito, denegacion de capacidad,
// error genericoy re-registro del mismo agente) con stores fake en memoria
// y el UsageLedgerStore REAL (InMemoryUsageLedgerStore) para verificar que
// los contadores se incrementan sin pisar datos previos del periodo.

import { describe, it, expect } from "vitest";
import { recordToolInvocation } from "../../packages/mcp-server/src/audit/record-tool-invocation";
import { CapabilityDeniedError } from "../../packages/mcp-server/src/permissions/require-capability";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import type { AuditLogEntry, AuditLogStore } from "../../packages/mcp-server/src/audit/types";

function fakeAuditLog() {
  const entries: AuditLogEntry[] = [];
  const store: AuditLogStore = {
    append: async (entry) => {
      entries.push(entry);
    },
    list: async () => entries,
  };
  return { store, entries };
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const agent = { key: "ed25519:agente-1", displayName: "Agente 1" };

describe("recordToolInvocation", () => {
  it("exito: devuelve el resultado, audita success y contabiliza free-tier en el ledger", async () => {
    const { store: auditLog, entries } = fakeAuditLog();
    const ledger = new InMemoryUsageLedgerStore();

    const result = await recordToolInvocation(auditLog, ledger, {
      agentKeyId: agent.key,
      toolName: "content:read",
      capabilityId: "content:read",
      run: async () => ({ ok: true }),
    });

    expect(result).toEqual({ ok: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      agentKeyId: agent.key,
      toolName: "content:read",
      capabilityId: "content:read",
      outcome: "success",
    });
    expect(entries[0].errorCode).toBeUndefined();

    const period = await ledger.get(currentPeriod());
    expect(period!.agents).toHaveLength(1);
    expect(period!.agents[0]).toMatchObject({
      operatorKeyId: agent.key,
      requestsTotal: 1,
      requestsFreeTier: 1,
      requestsCharged: 0,
      policyViolationsDetected: 0,
    });
    expect(period!.agents[0].firstSeen).toBe(period!.agents[0].lastSeen);
  });

  it("una segunda invocacion del mismo agente acumula contadores en la misma entrada", async () => {
    const { store: auditLog, entries } = fakeAuditLog();
    const ledger = new InMemoryUsageLedgerStore();
    const input = {
      agentKeyId: agent.key,
      toolName: "content:read",
      capabilityId: null,
      run: async () => "r",
    };
    await recordToolInvocation(auditLog, ledger, input);
    await recordToolInvocation(auditLog, ledger, input);

    expect(entries).toHaveLength(2);
    const period = await ledger.get(currentPeriod());
    expect(period!.agents).toHaveLength(1);
    expect(period!.agents[0].requestsTotal).toBe(2);
    expect(period!.agents[0].requestsFreeTier).toBe(2);
  });

  it("CapabilityDeniedError: outcome denied, incrementa violaciones y re-lanza", async () => {
    const { store: auditLog, entries } = fakeAuditLog();
    const ledger = new InMemoryUsageLedgerStore();

    await expect(
      recordToolInvocation(auditLog, ledger, {
        agentKeyId: agent.key,
        toolName: "content:write",
        capabilityId: "content:write",
        run: async () => {
          throw new CapabilityDeniedError(agent, "content:write");
        },
      })
    ).rejects.toThrow(CapabilityDeniedError);

    expect(entries[0].outcome).toBe("denied");
    expect(entries[0].errorCode).toBe("capability_denied");
    const period = await ledger.get(currentPeriod());
    expect(period!.agents[0].policyViolationsDetected).toBe(1);
    expect(period!.agents[0].requestsTotal).toBe(1);
  });

  it("error generico: outcome error, NO cuenta como violacion y re-lanza", async () => {
    const { store: auditLog, entries } = fakeAuditLog();
    const ledger = new InMemoryUsageLedgerStore();

    await expect(
      recordToolInvocation(auditLog, ledger, {
        agentKeyId: agent.key,
        toolName: "fetch:url",
        capabilityId: "network:fetch",
        run: async () => {
          throw new Error("timeout de red");
        },
      })
    ).rejects.toThrow("timeout de red");

    expect(entries[0].outcome).toBe("error");
    expect(entries[0].errorCode).toBe("operation_failed");
    const period = await ledger.get(currentPeriod());
    expect(period!.agents[0].policyViolationsDetected).toBe(0);
    expect(period!.agents[0].requestsTotal).toBe(1);
  });

  it("no pisa datos previos del periodo (otros agentes ya registrados)", async () => {
    const { store: auditLog } = fakeAuditLog();
    const ledger = new InMemoryUsageLedgerStore();
    const period = currentPeriod();
    await ledger.put(period, {
      period,
      generatedAt: "2026-01-01T00:00:00.000Z",
      agents: [
        {
          operatorKeyId: "otro-agente",
          requestsTotal: 10,
          requestsCharged: 4,
          requestsFreeTier: 6,
          revenueUsd: 0.5,
          policyViolationsDetected: 2,
          firstSeen: "2026-01-01T00:00:00.000Z",
          lastSeen: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    await recordToolInvocation(auditLog, ledger, {
      agentKeyId: agent.key,
      toolName: "content:read",
      capabilityId: null,
      run: async () => 1,
    });

    const after = await ledger.get(period);
    expect(after!.agents).toHaveLength(2);
    const other = after!.agents.find((a) => a.operatorKeyId === "otro-agente")!;
    expect(other.requestsTotal).toBe(10); // intacto
    expect(other.revenueUsd).toBe(0.5);
    expect(after!.agents.find((a) => a.operatorKeyId === agent.key)!.requestsTotal).toBe(1);
    expect(after!.generatedAt >= "2026-01-02").toBe(true); // generatedAt refrescado
  });
});
