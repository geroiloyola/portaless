// Slice de extensibilidad del catalogo de elementos via element packs
// (ROADMAP Phase 6, item 7 -- docs/architecture/element-catalog-plugins.md).
//
// Cubre el vertical completo: validacion pura del pack -> persistencia ->
// fusion en el catalogo -> validacion de paginas -> render (static/request/
// placeholder) -> visibilidad y uso desde el MCP.

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  validateElementPack,
  resolveCatalog,
  coreCatalog,
} from "../../packages/atomic-elements/src/elements/element-pack";
import type { ElementPack } from "../../packages/atomic-elements/src/elements/element-pack";
import {
  demoElementPack,
  catalogFromStore,
  InMemoryElementPackStore,
} from "../../packages/atomic-elements/src/persistence/element-pack-store";
import { elementRegistry, elementPalette } from "../../packages/atomic-elements/src/elements/registry";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema";
import { renderNode, renderPage } from "../../packages/atomic-elements/src/render";
import type { PageLayout, ElementNode } from "../../packages/atomic-elements/src/types";

import { checkNodeTypes, findUnknownTypes } from "../../packages/mcp-server/src/tools/element-node-schema";
import { createPortalessMcpServer } from "../../packages/mcp-server/src/server";
import { createEnvAgentIdentityResolver } from "../../packages/mcp-server/src/permissions/agent-identity";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { InMemoryAuditLogStore } from "../../packages/mcp-server/src/audit/in-memory-audit-log-store";

const CORE_TYPES = Object.keys(elementRegistry);
const demoPack = demoElementPack();

function badgeNode(props: Record<string, unknown> = {}, id = "b1"): ElementNode {
  return { id, type: "demo.Badge", props };
}

function layoutWith(root: ElementNode[]): PageLayout {
  return { version: "0.1", slug: "pagina", title: "Pagina", root };
}

// ---------------------------------------------------------------- validate

describe("validateElementPack", () => {
  it("acepta el pack demo contra el catalogo core", () => {
    const result = validateElementPack(demoPack, CORE_TYPES);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rechaza un type sin namespacing (no puede colisionar con el core)", () => {
    const pack = structuredClone(demoPack);
    pack.elements[0].type = "Badge";
    const result = validateElementPack(pack, CORE_TYPES);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("namespaced");
  });

  it("rechaza un type que sombrea un tipo core", () => {
    const pack = structuredClone(demoPack);
    pack.elements[0].type = "pkg.Hero"; // no core, pero probamos con type core real abajo
    const corePack: ElementPack = {
      name: "malo",
      version: "1",
      elements: [{ ...structuredClone(demoPack).elements[0], type: "Hero" }],
    };
    const result = validateElementPack(corePack, CORE_TYPES);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("core");
    expect(validateElementPack(pack, CORE_TYPES).valid).toBe(true);
  });

  it("rechaza render.kind distinto de html-template (v1 no ejecuta JS de plugin)", () => {
    const pack = structuredClone(demoPack);
    (pack.elements[0].render as { kind: string }).kind = "function";
    const result = validateElementPack(pack, CORE_TYPES);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("html-template");
  });

  it("rechaza types duplicados dentro de un pack", () => {
    const pack = structuredClone(demoPack);
    pack.elements.push(structuredClone(pack.elements[0]));
    const result = validateElementPack(pack, CORE_TYPES);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("duplicado");
  });
});

// ---------------------------------------------------------------- catalogo

describe("resolveCatalog / coreCatalog", () => {
  it("coreCatalog es exactamente el core, sin packs", () => {
    const catalog = coreCatalog(elementRegistry, elementPalette);
    expect(catalog.packTypes()).toEqual([]);
    expect(catalog.has("Hero")).toBe(true);
    expect(catalog.has("demo.Badge")).toBe(false);
    expect(catalog.allTypes()).toEqual(elementPalette);
  });

  it("con el pack demo: el tipo pack es visible y la paleta lo agrega despues del core", () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    expect(catalog.has("demo.Badge")).toBe(true);
    expect(catalog.packTypes()).toEqual(["demo.Badge"]);
    const all = catalog.allTypes();
    expect(all).toEqual([...elementPalette, "demo.Badge"]);
    const entry = catalog.lookup("demo.Badge");
    expect(entry?.kind).toBe("pack");
    if (entry?.kind === "pack") expect(entry.packName).toBe("demo-pack");
  });

  it("un pack no puede sombrear el core (defense in depth, aunque validate ya lo rechaza)", () => {
    const shadow: ElementPack = {
      name: "shadow",
      version: "1",
      elements: [{ ...structuredClone(demoPack).elements[0], type: "Hero" }],
    };
    const catalog = resolveCatalog(elementRegistry, elementPalette, [shadow]);
    const entry = catalog.lookup("Hero");
    expect(entry?.kind).toBe("core");
    expect(catalog.packTypes()).toEqual([]);
  });
});

// ------------------------------------------------------------- persistencia

describe("catalogFromStore", () => {
  it("el store sembrado con el pack demo produce un catalogo con demo.Badge", async () => {
    const store = new InMemoryElementPackStore(true);
    const catalog = await catalogFromStore(store, elementRegistry, elementPalette);
    expect(catalog.has("demo.Badge")).toBe(true);
  });

  it("un pack invalido en el store se IGNORA, no tira abajo el catalogo", async () => {
    const store = new InMemoryElementPackStore(false);
    await store.save({ name: "bueno", version: "1", elements: [structuredClone(demoPack).elements[0]] });
    // InMemory.save no valida (a proposito: la validacion es al cargar/registro).
    await store.save({ name: "malo", version: "1", elements: [{ type: "SinName" }] as never });
    const catalog = await catalogFromStore(store, elementRegistry, elementPalette);
    expect(catalog.has("demo.Badge")).toBe(true);
    expect(catalog.has("SinName")).toBe(false);
    expect(catalog.packTypes()).toEqual(["demo.Badge"]);
  });
});

// --------------------------------------------------------------- validacion

describe("validatePageLayout con catalogo", () => {
  it("acepta un nodo de pack cuando se pasa el catalogo", () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    const result = validatePageLayout(layoutWith([badgeNode()]), catalog);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("SIN catalogo valida solo el core y rechaza el tipo de pack (retro-compat)", () => {
    const result = validatePageLayout(layoutWith([badgeNode()]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("demo.Badge");
  });

  it("rechaza un tipo namespaced que ningun pack provee, aunque se pase el catalogo", () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    const result = validatePageLayout(layoutWith([{ id: "x", type: "nope.Nope", props: {} }]), catalog);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("nope.Nope");
  });
});

// -------------------------------------------------------------------- render

describe("render de elementos de pack", () => {
  it("modo static: interpola el template escapando los valores", async () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    const html = await renderNode(badgeNode({ label: "Hola", tone: "danger" }), { catalog });
    expect(html).toContain("ae-demo-badge--danger");
    expect(html).toContain(">Hola</span>");
  });

  it("escapa HTML en las props (no inyeccion desde el pack)", async () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    const html = await renderNode(badgeNode({ label: '<script>alert(1)</script>' }), { catalog });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("modo static con requiresEdgeEval emite placeholder y NO accede a las props", async () => {
    const edge: ElementPack = {
      name: "edge-pack",
      version: "1",
      elements: [
        {
          ...structuredClone(demoPack).elements[0],
          type: "edge.Locked",
          defaultProps: { secret: "SUPERSECRETO" },
          render: { kind: "html-template", template: "{{secret}}", requiresEdgeEval: true },
        },
      ],
    };
    const catalog = resolveCatalog(elementRegistry, elementPalette, [edge]);
    const html = await renderNode(
      { id: "e1", type: "edge.Locked", props: { secret: "SUPERSECRETO" } },
      { catalog, mode: "static" }
    );
    expect(html).toContain("data-portaless-edge=\"edge.Locked\"");
    expect(html).not.toContain("SUPERSECRETO");
  });

  it("modo request con dynamicRenderer resuelve el contenido real", async () => {
    const edge: ElementPack = {
      name: "edge-pack",
      version: "1",
      elements: [
        {
          ...structuredClone(demoPack).elements[0],
          type: "edge.Locked",
          render: { kind: "html-template", template: "{{secret}}", requiresEdgeEval: true },
        },
      ],
    };
    const catalog = resolveCatalog(elementRegistry, elementPalette, [edge]);
    const html = await renderNode(
      { id: "e1", type: "edge.Locked", props: { secret: "visible" } },
      {
        catalog,
        mode: "request",
        dynamicRenderer: async (node) => `<div>${String(node.props.secret)}</div>`,
      }
    );
    expect(html).toBe("<div>visible</div>");
  });

  it("renderPage con catalogo compone core y pack en la misma pagina", async () => {
    const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);
    const layout = layoutWith([badgeNode({ label: "Beta" })]);
    const html = await renderPage(layout, { catalog });
    expect(html).toContain(">Beta</span>");
  });
});

// --------------------------------------------------------- membership (MCP)

describe("checkNodeTypes / findUnknownTypes", () => {
  const catalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);

  it("encuentra tipos unknown en children y columnSlots", () => {
    const node: ElementNode = {
      id: "root",
      type: "Columns",
      props: {},
      columnSlots: [[badgeNode({}, "c1")], [{ id: "c2", type: "nope.Nope", props: {} }]],
      children: [{ id: "k1", type: "nope.Nope", props: {} }],
    };
    expect(findUnknownTypes([node], (t) => catalog.has(t))).toEqual(["nope.Nope"]);
  });

  it("devuelve null cuando todos los tipos estan en el catalogo", () => {
    expect(checkNodeTypes([badgeNode()], catalog)).toBeNull();
  });

  it("devuelve un mensaje accionable con los tipos fuera del catalogo", () => {
    const err = checkNodeTypes([{ id: "x", type: "nope.Nope", props: {} }], catalog);
    expect(err).toContain("nope.Nope");
    expect(err).toContain("list_page_components");
  });
});

// ------------------------------------------------------------------ MCP e2e

const ENV_AGENT = { key: "ed25519:pack-agent", displayName: "Agente Pack" };

async function connectedClientWithCatalog() {
  const permissionStore = new InMemoryPermissionStore();
  await permissionStore.setGrant({
    subject: { type: "agent", id: ENV_AGENT.key, displayName: ENV_AGENT.displayName },
    capabilityId: "content:write",
    granted: true,
    grantedBy: "test-seed",
  });
  const saved: Array<Record<string, unknown>> = [];
  const pageStore = {
    save: async (layout: Record<string, unknown>) => {
      saved.push(layout);
      return layout;
    },
    load: async () => null,
  };

  const elementCatalog = resolveCatalog(elementRegistry, elementPalette, [demoPack]);

  const server = createPortalessMcpServer({
    pageStore: pageStore as never,
    permissionStore,
    pluginRegistry: { list: async () => [] } as never,
    auditLog: new InMemoryAuditLogStore(),
    usageLedger: new InMemoryUsageLedgerStore(),
    resolveAgent: createEnvAgentIdentityResolver({
      MCP_AGENT_KEY: ENV_AGENT.key,
      MCP_AGENT_DISPLAY_NAME: ENV_AGENT.displayName,
    } as NodeJS.ProcessEnv),
    elementCatalog,
  });

  const client = new Client({ name: "pack-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, saved };
}

describe("MCP -- element packs visibles y usables", () => {
  it("list_page_components muestra demo.Badge como source=pack", async () => {
    const { client } = await connectedClientWithCatalog();
    const result = await client.callTool({ name: "list_page_components", arguments: {} });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.elementTypes).toContain("demo.Badge");
    expect(payload.packTypes).toEqual(["demo.Badge"]);
    const badge = payload.elements.find((e: { type: string }) => e.type === "demo.Badge");
    expect(badge).toMatchObject({ type: "demo.Badge", source: "pack", packName: "demo-pack" });
    expect(typeof badge.displayName).toBe("string");
    // El template de render es data del host, no input de un agente.
    expect(badge.render).toBeUndefined();
    // Los tipos core conservan source=core.
    const hero = payload.elements.find((e: { type: string }) => e.type === "Hero");
    expect(hero.source).toBe("core");
  });

  it("create_page acepta demo.Badge cuando el catalogo lo incluye", async () => {
    const { client, saved } = await connectedClientWithCatalog();
    const result = await client.callTool({
      name: "create_page",
      arguments: { slug: "con-pack", title: "Con pack", root: [badgeNode()], draftMode: true },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload).toMatchObject({ saved: true, slug: "con-pack" });
    expect(saved).toHaveLength(1);
    expect((saved[0].root as ElementNode[])[0].type).toBe("demo.Badge");
  });

  it("create_page rechaza un tipo namespaced que ningun pack provee", async () => {
    const { client, saved } = await connectedClientWithCatalog();
    const result = await client.callTool({
      name: "create_page",
      arguments: {
        slug: "falso",
        title: "Falso",
        root: [{ id: "f1", type: "nope.Nope", props: {} }],
        draftMode: true,
      },
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toContain("nope.Nope");
    expect(saved).toHaveLength(0);
  });

  it("sin elementCatalog (retro-compat), create_page rechaza el tipo de pack", async () => {
    const permissionStore = new InMemoryPermissionStore();
    await permissionStore.setGrant({
      subject: { type: "agent", id: ENV_AGENT.key, displayName: ENV_AGENT.displayName },
      capabilityId: "content:write",
      granted: true,
      grantedBy: "test-seed",
    });
    const saved: Array<Record<string, unknown>> = [];
    const server = createPortalessMcpServer({
      pageStore: { save: async (l: Record<string, unknown>) => void saved.push(l), load: async () => null } as never,
      permissionStore,
      pluginRegistry: { list: async () => [] } as never,
      auditLog: new InMemoryAuditLogStore(),
      usageLedger: new InMemoryUsageLedgerStore(),
      resolveAgent: createEnvAgentIdentityResolver({
        MCP_AGENT_KEY: ENV_AGENT.key,
        MCP_AGENT_DISPLAY_NAME: ENV_AGENT.displayName,
      } as NodeJS.ProcessEnv),
      // sin elementCatalog -> toolCatalog cae al core
    });
    const client = new Client({ name: "no-catalog", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const result = await client.callTool({
      name: "create_page",
      arguments: { slug: "x", title: "X", root: [badgeNode()], draftMode: true },
    });
    expect(result.isError).toBe(true);
    expect(saved).toHaveLength(0);
  });
});
