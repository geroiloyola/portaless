// Preview privado de una pagina draft/private. Ruta admin (session middleware)
// y permiso admin adicional. No delega a context.next(): un preview nunca cae
// al HTML estatico publico, incluso si la DB falla o la fila no existe.
import { createPageStore } from "../../../../packages/atomic-elements/src/persistence/store-factory.ts";
import { validatePageLayout } from "../../../../packages/atomic-elements/src/persistence/page-schema.ts";
import { renderPage } from "../../../../packages/atomic-elements/src/render.ts";
import { isPubliclyPublishable } from "../../../../packages/deploy-engine/src/draft-filter.ts";
import { renderShell } from "../../../pages/[slug].js";

function text(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "private, no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...headers,
    },
  });
}

export async function onRequestGet(context) {
  const user = context.data?.user;
  if (!user) return text("Not Found", 404);
  if (user.role !== "admin") return text("Forbidden", 403);

  const slug = context.params?.slug;
  if (typeof slug !== "string" || !slug || slug.includes("/") || slug.includes("..")) return text("Not Found", 404);

  let store;
  let layout;
  try {
    store = await createPageStore(context.env);
    layout = await store.load(slug);
  } catch {
    return text("Preview unavailable", 503);
  } finally {
    store?.close?.();
  }

  // No revelar si una URL publica existe via este endpoint de preview.
  if (!layout || isPubliclyPublishable(layout)) return text("Not Found", 404);
  const validation = validatePageLayout(layout);
  if (!validation.valid) return text("Preview unavailable", 503);

  try {
    const bodyHtml = await renderPage(layout);
    return new Response(renderShell(layout, bodyHtml, context.request, { preview: true }), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-robots-tag": "noindex, nofollow, noarchive",
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    return text("Preview unavailable", 503);
  }
}
