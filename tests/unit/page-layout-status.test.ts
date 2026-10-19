// PageLayout.status nativo (draft/published/private) + C06: solo admin promueve
// una pagina a public; MCP no publica ni modifica una pagina ya publicada.
//
// Cubre: (1) validatePageLayout acepta los valores validos y el ausente
// (compatibilidad hacia atras con el layout JSON ya persistido) y rechaza un
// valor invalido; (2) MCP solo edita drafts y no puede publicar ni acceder a private.

import { describe, it, expect } from "vitest";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema";
import { registerUpdatePageTool } from "../../packages/mcp-server/src/tools/update-page";
import { InMemoryPermissionStore } from "../../packages/permissions/src/permission-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import type { PageLayout } from "../../packages/atomic-elements/src/types";
import type { AuditLogStore } from "../../packages/mcp-server/src/audit/types";

function base(overrides: Partial<PageLayout> = {}): PageLayout {
  return { version: "0.1", slug: "contacto", title: "Contacto", root: [], ...overrides };
}

describe("validatePageLayout -- status", () => {
  it("acepta status 'draft'", () => {
    expect(validatePageLayout(base({ status: "draft" })).valid).toBe(true);
  });

  it("acepta status 'published'", () => {
    expect(validatePageLayout(base({ status: "published" })).valid).toBe(true);
  });

  it("acepta status 'private'", () => {
    expect(validatePageLayout(base({ status: "private" })).valid).toBe(true);
  });

  it("acepta status ausente (layout legacy, compatibilidad hacia atras)", () => {
    expect(validatePageLayout(base()).valid).toBe(true);
  });

  it("RECHAZA un status invalido", () => {
    const r = validatePageLayout(base({ status: "archived" as never }));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/"status" debe ser "draft", "published" o "private"/);
  });
});

describe("update_page -- MCP no publica ni muta paginas publicas", () => {
  type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

  async function harness(seed: PageLayout) {
    let current: PageLayout | null = seed;
    const saved: PageLayout[] = [];
    const pageStore = {
      load: async (slug: string) => (current && current.slug === slug ? current : null),
      save: async (layout: PageLayout) => {
        current = layout;
        saved.push(JSON.parse(JSON.stringify(layout)));
        return layout;
      },
    };
    const permissionStore = new InMemoryPermissionStore();
    const subject = { type: "agent" as const, id: "ed25519:a", displayName: "A" };
    for (const capabilityId of ["content:read", "content:write"]) {
      await permissionStore.setGrant({ subject, capabilityId, granted: true, grantedBy: "test-seed" });
    }
    const auditLog: AuditLogStore = { append: async () => {}, list: async () => [] };
    const tools = new Map<string, ToolHandler>();
    registerUpdatePageTool(
      { registerTool: (name: string, _c: unknown, h: ToolHandler) => { tools.set(name, h); return {}; } } as never,
      {
        pageStore: pageStore as never,
        permissionStore,
        auditLog,
        usageLedger: new InMemoryUsageLedgerStore(),
        resolveAgent: async () => ({ key: subject.id, displayName: subject.displayName }),
      }
    );
    const extra = { authInfo: { token: "t" } };
    return { handler: tools.get("update_page")!, extra, current: () => current, saved };
  }

  it("rechaza status published aunque se invoque el handler directamente", async () => {
    const h = await harness(base({ status: "draft" }));
    const res = await h.handler({ slug: "contacto", status: "published" }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ saved: false, error: "publication_requires_admin_approval" });
    expect(h.current()?.status).toBe("draft");
    expect(h.saved).toHaveLength(0);
  });

  it("rechaza cambios a una pagina publicada sin sobrescribir el canon", async () => {
    const h = await harness(base({ status: "published", title: "Publica original" }));
    const res = await h.handler({ slug: "contacto", title: "Sustitucion del agente" }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ saved: false, error: "published_page_requires_admin_approval" });
    expect(h.current()?.title).toBe("Publica original");
    expect(h.saved).toHaveLength(0);
  });

  it("rechaza acceso MCP a una pagina privada", async () => {
    const h = await harness(base({ status: "private", title: "Privada original" }));
    const res = await h.handler({ slug: "contacto", title: "Intento de lectura/escritura" }, h.extra);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe("private_content_access_denied");
    expect(h.current()?.title).toBe("Privada original");
    expect(h.saved).toHaveLength(0);
  });

  it("permite actualizar un borrador y conserva el status", async () => {
    const h = await harness(base({ status: "draft" }));
    await h.handler({ slug: "contacto", title: "Contacto v2" }, h.extra);
    expect(h.current()?.status).toBe("draft");
    expect(h.current()?.title).toBe("Contacto v2");
  });
});
