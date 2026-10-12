// GET /api/site-skin -> hoja CSS publica con los tokens del skin activo
// del sitio emitidos como variables en :root (Phase 0 — visual identity
// foundation). global.css ya trae la paleta oficial como default; esta
// hoja la sobreescribe si el admin cambio el skin o los tokens desde
// /admin/appearance. Sin fila en site_skin responde igual (skin base,
// sin overrides) para que el <link> de BaseLayout sea siempre valido en
// self-host y Cloudflare Pages; en hosting estatico (GitHub Pages) el
// 404 lo ignora el navegador y manda el default de global.css.
//
// Publico a proposit: no lleva identidad ni sesion, solo colores. Los
// valores pasan por sanitizeTokens() en el emisor (defensa en
// profundidad) -- ver site-skin-store.ts.

import { createSiteSkinStore, resolveActiveSkin, emitSiteSkinCss, SITE_ID } from "../../packages/dashboard/src/skin-engine/site-skin-store.ts";

export async function onRequestGet(context) {
  const { env } = context;
  let record = null;
  let css;
  try {
    const store = await createSiteSkinStore(env);
    record = await store.get(SITE_ID);
    const resolved = await resolveActiveSkin(record?.skin ?? "base", record?.tokens ?? {});
    css = emitSiteSkinCss(resolved.light, resolved.dark);
  } catch {
    // Nunca romper la pagina por el tema: hoja vacia -> manda global.css.
    css = "/* site-skin no disponible */\n";
  }
  return new Response(css, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
