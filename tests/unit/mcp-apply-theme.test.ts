// packages/mcp-server/src/tools/{list-themes,apply-theme}: los dos tools
// del sistema de temas por pagina. Cubre: list_themes (builtins por
// defecto, instalados con source, vars resueltas con extends),
// apply_theme (escribe PageLayout.theme, lo borra con null, auditoria +
// ledger igual que update_page), membership accionable (tema inexistente
// o cadena extends rota -> error que lista los disponibles, sin guardar),
// la barrea de capacidades (content:read para leer, content:write para
// guardar) y el caso de pagina inexistente.

import { describe, it, expect } from "vitest";
import {
  createBearerTokenAgentIdentityResolver,
} from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryMcpAgentTokenStore } from "../../packages/mcp-server/src/permissions/agent-token-store";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { CapabilityDeniedError } from "../../packages/mcp-server/src/permissions/require-capability";
import { registerApplyThemeTool } from "../../packages/mcp-server/src/tools/apply-theme";
import { registerListThemesTool } from "../../packages/mcp-server/src/tools/list-themes";
import { BUILTIN_THEMES, availableThemes } from "../../packages/atomic-elements/src/themes/theme-pack";
import type { ThemePack } from "../../packages/atomic-elements/src/themes/theme-pack";
import type { AuditLogEntry, AuditLogStore } from "../../packages/mcp-server/src/audit/types";
import type { PageLayout } from "../../packages/atomic-elements/src/types";

type ToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

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

const AGENT = { agentKeyId: "ed25519:agente-temas", displayName: "Agente Temas" };

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

function seedLayout(fields: Partial<PageLayout> = {}): PageLayout {
  return {
    version: "0.1",
    slug: "perfil",
    title: "Perfil",
    root: [{ id: "n1", type: "Paragraph", props: { text: "hola" } }],
    ...fields,
  };
}

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

const INSTALADO: ThemePack = {
  name: "fiesta",
  displayName: "Fiesta",
  extends: "2pac-dark",
  vars: { "--accent": "#C5D86D" },
};

async function harness(options: { seed?: PageLayout | null; themes?: ThemePack[]; revokeWrite?: boolean } = {}) {
  const { extra, resolveAgent, permissionStore } = await seeded();
  if (options.revokeWrite) {
    await permissionStore.setGrant({
      subject: { type: "agent", id: AGENT.agentKeyId, displayName: AGENT.displayName },
      capabilityId: "content:write",
      granted: false,
      grantedBy: "test-seed",
    });
  }
  const { store, saved, getCurrent } = memoryPageStore(options.seed === undefined ? seedLayout() : options.seed);
  const { store: auditLog, entries } = fakeAuditLog();
  const themes = options.themes ?? [...BUILTIN_THEMES];
  const deps = {
    pageStore: store,
    permissionStore,
    auditLog,
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent,
    themes,
  };
  const { server: s1, tools: t1 } = fakeMcpServer();
  registerApplyThemeTool(s1, deps);
  const { server: s2, tools: t2 } = fakeMcpServer();
  registerListThemesTool(s2, { themes });
  return {
    apply: t1.get("apply_theme")!,
    list: t2.get("list_themes")!,
    extra,
    saved,
    entries,
    current: getCurrent,
  };
}

describe("list_themes", () => {
  it("por defecto lista los builtins con sus vars resueltas y source builtin", async () => {
    const h = await harness();
    const res = await h.list({}, h.extra);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.themes).toHaveLength(2);
    expect(parsed.themes[0]).toMatchObject({ name: "2pac-dark", source: "builtin" });
    expect(parsed.themes[0].vars["--bg"]).toBe("#14100C");
    expect(parsed.themes[0].vars["--radius"]).toBeUndefined(); // no declarado: hereda
    expect(parsed.themes[1]).toMatchObject({ name: "portaless-nocturno", source: "builtin" });
  });

  it("los instalados aparecen con source installed y el extends ya resuelto", async () => {
    const h = await harness({ themes: availableThemes([INSTALADO]) });
    const parsed = JSON.parse((await h.list({}, h.extra)).content[0].text);
    const fiesta = parsed.themes.find((t: any) => t.name === "fiesta");
    expect(fiesta.source).toBe("installed");
    // hereda lo oscuro del builtin y encima pone su acento
    expect(fiesta.vars["--bg"]).toBe("#14100C");
    expect(fiesta.vars["--accent"]).toBe("#C5D86D");
  });
});

describe("apply_theme", () => {
  it("aplica un builtin y lo persiste en la pagina", async () => {
    const h = await harness();
    const res = await h.apply({ slug: "perfil", theme: "2pac-dark" }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ saved: true, theme: "2pac-dark" });
    expect(h.current()?.theme).toBe("2pac-dark");
    expect(h.entries[0]).toMatchObject({ toolName: "apply_theme", capabilityId: "content:write" });
    expect(h.saved).toHaveLength(1);
  });

  it("theme null borra el campo (la pagina vuelve al skin del sitio)", async () => {
    const h = await harness({ seed: seedLayout({ theme: "2pac-dark" }) });
    const res = await h.apply({ slug: "perfil", theme: null }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ saved: true, theme: null });
    expect(h.current()).not.toHaveProperty("theme");
    expect(h.current()?.slug).toBe("perfil"); // el resto de la pagina queda intacto
  });

  it("ERROR accionable con tema inexistente: lista los disponibles y no guarda", async () => {
    const h = await harness();
    const res = await h.apply({ slug: "perfil", theme: "no-existe" }, h.extra);
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.error).toMatch(/no existe/);
    expect(payload.error).toContain("2pac-dark");
    expect(h.saved).toHaveLength(0);
    expect(h.current()?.theme).toBeUndefined();
  });

  it("ERROR si la cadena extends del tema esta rota (no se aplica un tema que no resuelve)", async () => {
    const roto: ThemePack = { name: "roto", displayName: "Roto", extends: "fantasma", vars: { "--bg": "#000" } };
    const h = await harness({ themes: availableThemes([roto]) });
    const res = await h.apply({ slug: "perfil", theme: "roto" }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/extends/);
    expect(h.saved).toHaveLength(0);
  });

  it("aplica un tema instalado (membership sobre builtin ∪ instalados)", async () => {
    const h = await harness({ themes: availableThemes([INSTALADO]) });
    const res = await h.apply({ slug: "perfil", theme: "fiesta" }, h.extra);
    expect(res.isError).toBeFalsy();
    expect(h.current()?.theme).toBe("fiesta");
  });

  it("ERROR si la pagina no existe y no guarda nada", async () => {
    const h = await harness();
    const res = await h.apply({ slug: "fantasma", theme: "2pac-dark" }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/No existe una pagina/);
    expect(h.saved).toHaveLength(0);
  });

  it("exige content:read y content:write (sin write no escribe)", async () => {
    const { extra, resolveAgent, permissionStore } = await seeded();
    await permissionStore.setGrant({
      subject: { type: "agent", id: AGENT.agentKeyId, displayName: AGENT.displayName },
      capabilityId: "content:write",
      granted: false,
      grantedBy: "test-seed",
    });
    const { store, saved } = memoryPageStore(seedLayout());
    const { store: auditLog } = fakeAuditLog();
    const { server, tools } = fakeMcpServer();
    registerApplyThemeTool(server, {
      pageStore: store,
      permissionStore,
      auditLog,
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent,
    });
    const handler = tools.get("apply_theme")!;
    const denial = await handler({ slug: "perfil", theme: "2pac-dark" }, extra).catch((e) => e);
    expect(denial).toBeInstanceOf(CapabilityDeniedError);
    expect(saved).toHaveLength(0);
  });
});
