// v0.0.9.27 -- POST /admin/api/wizard/generate-page (item 2 del roadmap).
// Recibe { siteName, siteIntent, siteDomain? } del Paso 1 del Wizard, genera
// un PageLayout con TemplateIntentToLayout y lo guarda como BORRADOR
// (slug-draft) via el PageStore real. Idempotente: si el borrador ya existe
// NO lo sobrescribe (el usuario pudo haberlo editado) y responde existed:true.
import { createPageStore } from "../../../../packages/atomic-elements/src/persistence/store-factory";
import { validatePageLayout } from "../../../../packages/atomic-elements/src/persistence/page-schema";
import { TemplateIntentToLayout } from "../../../../packages/onboarding/src/intent-to-layout";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

export async function onRequestPost(context) {
  const user = context.data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden", message: "Se requiere rol 'admin'." }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const siteName = str(body?.siteName);
  const siteIntent = str(body?.siteIntent);
  const siteDomain = str(body?.siteDomain) || undefined;
  if (!siteName || !siteIntent) return json({ error: "missing_fields", message: "siteName y siteIntent son obligatorios." }, 400);
  if (siteName.length > 80 || siteIntent.length > 1000) return json({ error: "too_long" }, 400);

  const { templateId, layout } = await new TemplateIntentToLayout().generate({ siteName, siteIntent, siteDomain });
  const validation = validatePageLayout(layout);
  if (!validation.valid) return json({ error: "template_invalid", details: validation.errors }, 500);

  const store = await createPageStore(context.env);
  const editorUrl = `/admin/editor?slug=${encodeURIComponent(layout.slug)}`;
  if (await store.load(layout.slug)) {
    return json({ ok: true, slug: layout.slug, templateId, editorUrl, existed: true });
  }
  await store.save(layout);
  return json({ ok: true, slug: layout.slug, templateId, editorUrl, existed: false }, 201);
}
