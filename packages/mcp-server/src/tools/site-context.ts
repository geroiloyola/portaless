import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PageStore } from "../../../atomic-elements/src/persistence/page-store";
import type { PermissionStore } from "../../../permissions/src/permission-store";
import type { SiteSkinStore } from "../../../dashboard/src/skin-engine/site-skin-store";
import { resolveThemePack, type ThemePack } from "../../../atomic-elements/src/themes/theme-pack";
import type { AuditLogStore } from "../audit/types";
import type { UsageLedgerStore } from "../../../trust-layer/src/ledger/log-writer";
import type { AgentIdentityResolver, AgentInvocationContext } from "../permissions/agent-identity";
import { requireCapability } from "../permissions/require-capability";
import { recordToolInvocation } from "../audit/record-tool-invocation";
import { DOC_ENTRIES } from "../../../../src/lib/docs-nav.mjs";
import { isPubliclyPublishable } from "../../../deploy-engine/src/draft-filter";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const READ = "content:read" as const;
const PRIVATE_READ = "mcp:private-context:read" as const;
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_SITE_PAGES = 100;

export interface SiteContextToolDeps {
  pageStore: PageStore;
  permissionStore: PermissionStore;
  auditLog: AuditLogStore;
  usageLedger: UsageLedgerStore;
  resolveAgent: AgentIdentityResolver;
  siteSkin?: SiteSkinStore;
  themes?: ThemePack[];
}

function bounded(value: unknown, maxBytes = MAX_CONTEXT_BYTES): unknown {
  const result = JSON.stringify(value);
  if (new TextEncoder().encode(result).byteLength > maxBytes) throw new Error("context_too_large");
  return value;
}

async function publicHistory(deps: SiteContextToolDeps, slug: string) {
  const layout = await deps.pageStore.load(slug);
  if (!layout || !isPubliclyPublishable(layout) || !layout.publicationId) return { layout: null, revisions: [] };
  const revisions = await deps.pageStore.listPublicRevisionsByPublicationId?.(layout.publicationId) ?? [];
  return { layout, revisions };
}

async function siteStyle(deps: SiteContextToolDeps) {
  try {
    const record = await deps.siteSkin?.get("default");
    return record ? { skin: record.skin, tokens: record.tokens, updatedAt: record.updatedAt } : null;
  } catch {
    return null;
  }
}

export function registerSiteContextTools(server: McpServer, deps: SiteContextToolDeps): void {
  server.registerTool("get_site_context", {
    title: "Leer contexto público autorizado del sitio",
    description: "Lista páginas publicadas con sus IDs/hash de revisión aprobada, skins/temas y solo los documentos Markdown del catálogo público autorizado. Nunca lee drafts, páginas privadas, archivos arbitrarios ni secretos. Requiere content:read.",
    inputSchema: {},
  }, async (_args, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "get_site_context", capabilityId: READ,
      subjectId: "public-site-context",
      run: async () => {
        await requireCapability(deps.permissionStore, agent, READ);
        const pages = [];
        const slugs = (await deps.pageStore.list()).sort();
        for (const slug of slugs.slice(0, MAX_SITE_PAGES)) {
          const { revisions } = await publicHistory(deps, slug);
          const head = revisions[0];
          if (head) pages.push({ slug, title: head.title, publicationId: head.publicationId, revisionId: head.revisionId, revisionNo: head.revisionNo, contentHash: head.contentHash });
        }
        return bounded({
          pages,
          pagesTruncated: slugs.length > MAX_SITE_PAGES,
          siteStyle: await siteStyle(deps),
          themes: (deps.themes ?? []).map(({ name, displayName, description, vars }) => ({ name, displayName, description, vars })),
          documentation: DOC_ENTRIES.map(({ slug, title, lang }) => ({ slug, title, lang })),
        });
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });

  server.registerTool("get_page_context", {
    title: "Leer una revisión pública de página",
    description: "Devuelve la última revisión aprobada (o la revisión aprobada indicada), su estructura completa, hash, historial y estilos de página/sitio. Drafts y páginas privadas no son visibles con content:read.",
    inputSchema: {
      slug: z.string().min(1),
      revisionId: z.string().uuid().optional().describe("Si se indica, solo se lee si esa revisión exacta fue aprobada y es pública."),
    },
  }, async ({ slug, revisionId }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "get_page_context", capabilityId: READ,
      subjectId: slug,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, READ);
        const { layout, revisions } = await publicHistory(deps, slug);
        if (!layout || revisions.length === 0) throw new Error("public_page_not_found");
        const selected = revisionId ? revisions.find((revision) => revision.revisionId === revisionId) : revisions[0];
        if (!selected) throw new Error("public_revision_not_found");
        const themes = deps.themes ?? [];
        const selectedTheme = selected.layout.theme ? resolveThemePack(themes, selected.layout.theme) : null;
        const context = {
          publicationId: selected.publicationId,
          revision: selected,
          revisionHistory: revisions.map(({ revisionId: id, revisionNo, contentHash, parentRevisionId, approvedAt }) => ({ revisionId: id, revisionNo, contentHash, parentRevisionId, approvedAt })),
          style: { site: await siteStyle(deps), page: selectedTheme ? { name: selectedTheme.name, vars: selectedTheme.vars } : null },
        };
        return bounded(context);
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });

  server.registerTool("read_documentation", {
    title: "Leer documentación pública autorizada",
    description: "Lee un documento Markdown del catálogo explícito de documentación pública. No acepta rutas, archivos arbitrarios ni acceso al archivo privado. Requiere content:read.",
    inputSchema: { documentId: z.string().min(1) },
  }, async ({ documentId }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "read_documentation", capabilityId: READ,
      subjectId: documentId,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, READ);
        const entry = DOC_ENTRIES.find((doc) => doc.slug === documentId);
        if (!entry) throw new Error("documentation_not_found");
        const markdown = await readFile(join(REPO_ROOT, entry.file), "utf8");
        return bounded({ slug: entry.slug, title: entry.title, lang: entry.lang, markdown });
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });

  server.registerTool("read_private_page_context", {
    title: "Leer el contexto de una página privada autorizada",
    description: "Lee únicamente el borrador o la página privada con el slug indicado. Requiere el grant independiente mcp:private-context:read; content:read no es suficiente.",
    inputSchema: { slug: z.string().min(1).max(200) },
  }, async ({ slug }, extra?: AgentInvocationContext) => {
    const agent = await deps.resolveAgent(extra);
    return recordToolInvocation(deps.auditLog, deps.usageLedger, {
      agentKeyId: agent.key, toolName: "read_private_page_context", capabilityId: PRIVATE_READ,
      subjectId: slug,
      run: async () => {
        await requireCapability(deps.permissionStore, agent, PRIVATE_READ);
        const layout = await deps.pageStore.load(slug);
        if (!layout || (layout.status !== "draft" && layout.status !== "private")) {
          throw new Error("private_page_not_found");
        }
        return bounded({ slug, title: layout.title, description: layout.description, status: layout.status, root: layout.root });
      },
    }).then((result) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }));
  });
}
