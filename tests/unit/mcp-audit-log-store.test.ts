import { describe, expect, it } from "vitest";
import { SqliteMcpAuditLogStore } from "../../packages/mcp-server/src/audit/persistent-audit-log-store";

describe("SqliteMcpAuditLogStore", () => {
  it("persists only allowlisted audit metadata and enforces append-only records", async () => {
    const store = await SqliteMcpAuditLogStore.open(":memory:");
    await store.append({
      timestamp: "2026-10-20T12:00:00.000Z",
      agentKeyId: "agent-key",
      toolName: "read_documentation",
      capabilityId: "content:read",
      outcome: "error",
      errorCode: "operation_failed",
      subjectId: "guide",
      pageBody: "must never be persisted",
    } as never);

    const entries = await store.list("2026-10-20T00:00:00.000Z");
    expect(entries).toEqual([{
      timestamp: "2026-10-20T12:00:00.000Z",
      agentKeyId: "agent-key",
      toolName: "read_documentation",
      capabilityId: "content:read",
      outcome: "error",
      errorCode: "operation_failed",
      subjectId: "guide",
    }]);

    const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
    expect(() => db.prepare("UPDATE mcp_audit_events SET outcome = 'success'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM mcp_audit_events").run()).toThrow(/append-only/);
  });
});
