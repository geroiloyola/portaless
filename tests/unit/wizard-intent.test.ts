// v0.0.9.27 -- item 2: IntentToLayout + POST /admin/api/wizard/generate-page.
// Incluye un test de CONTRATO de props contra elementRegistry, porque
// validatePageLayout no valida props ni recorre columnSlots.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyIntent, slugify, TemplateIntentToLayout, type TemplateId } from "../../packages/onboarding/src/intent-to-layout";
import { elementRegistry } from "../../packages/atomic-elements/src/elements/registry";
import { validatePageLayout } from "../../packages/atomic-elements/src/persistence/page-schema";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import type { ElementNode } from "../../packages/atomic-elements/src/types";
import { onRequestPost } from "../../functions/admin/api/wizard/generate-page.js";

const tmpPath = () => join(mkdtempSync(join(tmpdir(), "portaless-wizard-")), "pages.db");

function walk(nodes: ElementNode[], out: ElementNode[] = []): ElementNode[] {
  for (const node of nodes) {
    out.push(node);
    if (node.children) walk(node.children, out);
    node.columnSlots?.forEach((slot) => walk(slot, out));
  }
  return out;
}

const SAMPLES: Record<TemplateId, string> = {
  portfolio: "Soy fotógrafo y quiero un portafolio de arquitectura",
  store: "Quiero vender mis productos en una tienda online",
  "link-in-bio": "Soy creadora de contenido y quiero mis links en bio",
  landing: "Una web para mi estudio contable",
};

describe("classifyIntent / slugify", () => {
  for (const [id, text] of Object.entries(SAMPLES)) {
    it(`"${text}" -> ${id}`, () => expect(classifyIntent(text)).toBe(id));
  }
  it("slugify normaliza acentos, ñ y simbolos", () => {
    expect(slugify("Mi Portafolio Ñandú!")).toBe("mi-portafolio-nandu");
    expect(slugify("!!!")).toBe("inicio");
  });
});

describe("plantillas: contrato con elementRegistry", () => {
  for (const [id, text] of Object.entries(SAMPLES)) {
    it(`${id}: pasa validatePageLayout y cada prop existe en defaultProps con el mismo tipo`, async () => {
      const { templateId, layout } = await new TemplateIntentToLayout().generate({
        siteName: "Estudio Luz", siteIntent: text, siteDomain: "estudioluz.com",
      });
      expect(templateId).toBe(id);
      expect(layout.slug).toBe("estudio-luz-draft");
      expect(validatePageLayout(layout)).toEqual({ valid: true, errors: [] });

      const nodes = walk(layout.root);
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
      for (const node of nodes) {
        const defaults = elementRegistry[node.type].defaultProps as Record<string, unknown>;
        for (const [key, value] of Object.entries(node.props)) {
          expect(Object.keys(defaults), `${node.type}.${key}`).toContain(key);
          expect(typeof value, `${node.type}.${key}`).toBe(typeof defaults[key]);
        }
        expect(() => elementRegistry[node.type].renderHTML({ ...defaults, ...node.props } as never, "")).not.toThrow();
      }
    });
  }
});

function ctx(body: unknown, user: unknown, env: Record<string, unknown>) {
  return {
    request: new Request("https://site.test/admin/api/wizard/generate-page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    data: { user },
    env,
  };
}

describe("POST /admin/api/wizard/generate-page", () => {
  const admin = { username: "admin", role: "admin" };
  const body = { siteName: "Estudio Luz", siteIntent: SAMPLES.portfolio, siteDomain: "estudioluz.com" };

  it("crea el borrador (201) y lo persiste en el PageStore real", async () => {
    const env = { PORTALESS_SQLITE_PATH: tmpPath() };
    const res = await onRequestPost(ctx(body, admin, env) as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, slug: "estudio-luz-draft", templateId: "portfolio", existed: false });
    expect(data.editorUrl).toBe("/admin/editor?slug=estudio-luz-draft");
    expect((await (await createPageStore(env)).load("estudio-luz-draft"))?.title).toBe("Estudio Luz");
  });

  it("es idempotente: no sobrescribe un borrador ya editado", async () => {
    const env = { PORTALESS_SQLITE_PATH: tmpPath() };
    await onRequestPost(ctx(body, admin, env) as any);
    const store = await createPageStore(env);
    const edited = { ...(await store.load("estudio-luz-draft"))!, title: "Editado a mano" };
    await store.save(edited);

    const res = await onRequestPost(ctx(body, admin, env) as any);
    expect(res.status).toBe(200);
    expect((await res.json()).existed).toBe(true);
    expect((await store.load("estudio-luz-draft"))?.title).toBe("Editado a mano");
  });

  it("401 sin sesion, 403 sin rol admin, 400 sin campos o con JSON invalido", async () => {
    const env = { PORTALESS_SQLITE_PATH: tmpPath() };
    expect((await onRequestPost(ctx(body, undefined, env) as any)).status).toBe(401);
    expect((await onRequestPost(ctx(body, { role: "viewer" }, env) as any)).status).toBe(403);
    expect((await onRequestPost(ctx({ siteName: "x" }, admin, env) as any)).status).toBe(400);
    expect((await onRequestPost(ctx("{no json", admin, env) as any)).status).toBe(400);
  });
});
