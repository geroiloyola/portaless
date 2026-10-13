// packages/mcp-server/src/tools/{insert,update,delete}-block: manipulacion
// granular de nodos por nodeId sobre una pagina existente.
//
// Regresion que cubre: antes la unica forma de cambiar bloques era update_page
// reemplazando `root` entero. Estas tres tools permiten tocar un nodo sin
// reconstruir el arbol. Tambien valida el contrato de errores: pagina
// inexistente, nodeId inexistente, index fuera de rango -- todos como isError,
// sin guardar nada.

import { describe, it, expect } from "vitest";
import {
  createBearerTokenAgentIdentityResolver,
} from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryMcpAgentTokenStore } from "../../packages/mcp-server/src/permissions/agent-token-store";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { CapabilityDeniedError } from "../../packages/mcp-server/src/permissions/require-capability";
import { registerInsertBlockTool } from "../../packages/mcp-server/src/tools/insert-block";
import { registerUpdateBlockTool } from "../../packages/mcp-server/src/tools/update-block";
import { registerDeleteBlockTool } from "../../packages/mcp-server/src/tools/delete-block";
import type { AuditLogEntry, AuditLogStore } from "../../packages/mcp-server/src/audit/types";
import type { PageLayout, ElementNode } from "../../packages/atomic-elements/src/types";

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function fakeMcpServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
      return {};
    },
  };
  return { server: server as never, tools };
}

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

const AGENT = { agentKeyId: "ed25519:agente-bloques", displayName: "Agente Bloques" };

async function seeded() {
  const tokenStore = new InMemoryMcpAgentTokenStore();
  const { token } = await tokenStore.issue(AGENT);
  const resolveAgent = createBearerTokenAgentIdentityResolver(tokenStore);
  const permissionStore = new InMemoryPermissionStore();
  await permissionStore.setGrant({
    subject: { type: "agent", id: AGENT.agentKeyId, displayName: AGENT.displayName },
    capabilityId: "content:read",
    granted: true,
    grantedBy: "test-seed",
  });
  await permissionStore.setGrant({
    subject: { type: "agent", id: AGENT.agentKeyId, displayName: AGENT.displayName },
    capabilityId: "content:write",
    granted: true,
    grantedBy: "test-seed",
  });
  return { extra: { authInfo: { token } }, resolveAgent, permissionStore };
}

function seedLayout(): PageLayout {
  return {
    version: "0.1",
    slug: "nosotros",
    title: "Nosotros",
    root: [
      { id: "h1", type: "Heading", props: { text: "Titulo" } },
      { id: "p1", type: "Paragraph", props: { text: "Parrafo" } },
    ],
  };
}

// PageStore en memoria que carga/guarda el layout seed y captura cada save.
// getCurrent es FUNCION (no un valor destructurado) para que siempre lea el
// `current` interno ya actualizado tras cada save.
function memoryPageStore(seed: PageLayout | null) {
  const saved: PageLayout[] = [];
  let current = seed;
  const store = {
    load: async (slug: string) => (current && current.slug === slug ? current : null),
    save: async (layout: PageLayout) => {
      current = layout;
      saved.push(JSON.parse(JSON.stringify(layout)));
      return layout;
    },
  };
  return { store: store as never, saved, getCurrent: () => current };
}

function node(id: string, type: ElementNode["type"] = "Paragraph"): ElementNode {
  return { id, type, props: {} };
}

async function harness(seed: PageLayout | null = seedLayout()) {
  const { extra, resolveAgent, permissionStore } = await seeded();
  const { store, saved, getCurrent } = memoryPageStore(seed);
  const { store: auditLog, entries } = fakeAuditLog();
  const deps = {
    pageStore: store,
    permissionStore,
    auditLog,
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent,
  };
  const { server: s1, tools: t1 } = fakeMcpServer();
  registerInsertBlockTool(s1, deps);
  const { server: s2, tools: t2 } = fakeMcpServer();
  registerUpdateBlockTool(s2, deps);
  const { server: s3, tools: t3 } = fakeMcpServer();
  registerDeleteBlockTool(s3, deps);
  return {
    insert: t1.get("insert_block")!,
    update: t2.get("update_block")!,
    remove: t3.get("delete_block")!,
    extra,
    saved,
    entries,
    current: getCurrent,
  };
}

describe("insert_block", () => {
  it("inserta un bloque y guarda el arbol resultante", async () => {
    const h = await harness();
    const res = await h.insert({ slug: "nosotros", parentId: undefined, index: 0, node: node("nuevo") }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ saved: true, insertedId: "nuevo" });
    expect(h.current()?.root.map((n) => n.id)).toEqual(["nuevo", "h1", "p1"]);
    expect(h.entries[0]).toMatchObject({ toolName: "insert_block", capabilityId: "content:write" });
  });

  it("ERROR si la pagina no existe y no guarda nada", async () => {
    const h = await harness();
    const res = await h.insert({ slug: "fantasma", index: 0, node: node("n") }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/No existe una pagina/);
    expect(h.saved).toHaveLength(0);
  });

  it("ERROR si index esta fuera de rango y no guarda nada", async () => {
    const h = await harness();
    const res = await h.insert({ slug: "nosotros", index: 99, node: node("n") }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/fuera de rango/);
    expect(h.saved).toHaveLength(0);
  });
});

describe("update_block", () => {
  it("aplica el patch de props al nodo dado", async () => {
    const h = await harness();
    const res = await h.update({ slug: "nosotros", nodeId: "h1", props: { text: "Nuevo titulo" } }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(h.current()?.root.find((n) => n.id === "h1")?.props).toMatchObject({ text: "Nuevo titulo" });
  });

  it("ERROR si el nodeId no existe y no guarda nada", async () => {
    const h = await harness();
    const res = await h.update({ slug: "nosotros", nodeId: "fantasma", props: { text: "x" } }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/No existe un nodo/);
    expect(h.saved).toHaveLength(0);
  });
});

describe("delete_block", () => {
  it("elimina el nodo dado", async () => {
    const h = await harness();
    const res = await h.remove({ slug: "nosotros", nodeId: "h1" }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(h.current()?.root.map((n) => n.id)).toEqual(["p1"]);
  });

  it("ERROR si el nodeId no existe y no guarda nada", async () => {
    const h = await harness();
    const res = await h.remove({ slug: "nosotros", nodeId: "fantasma" }, h.extra);
    expect(res.isError).toBe(true);
    expect(h.saved).toHaveLength(0);
  });
});

describe("permisos de las tools de bloques", () => {
  it("insert_block exige content:write", async () => {
    const { extra, resolveAgent, permissionStore } = await seeded();
    // quitar content:write al agente
    await permissionStore.setGrant({
      subject: { type: "agent", id: AGENT.agentKeyId, displayName: AGENT.displayName },
      capabilityId: "content:write",
      granted: false,
      grantedBy: "test-seed",
    });
    const { store } = memoryPageStore(seedLayout());
    const { store: auditLog } = fakeAuditLog();
    const { server, tools } = fakeMcpServer();
    registerInsertBlockTool(server, {
      pageStore: store,
      permissionStore,
      auditLog,
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent,
    });
    const handler = tools.get("insert_block")!;
    const denial = await handler({ slug: "nosotros", index: 0, node: node("n") }, extra).catch((e) => e);
    expect(denial).toBeInstanceOf(CapabilityDeniedError);
  });
});
