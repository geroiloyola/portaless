// functions/api/analytics.js — Phase 6 (publication maturity).
//
// GET /api/analytics: el script de analytics del sitio, generado en runtime
// desde la tabla site_settings (lo que el admin configuro en
// /admin/analytics). El <head> de BaseLayout lo pide siempre, igual que
// /api/site-skin: si no hay nada configurado responde un no-op de unas
// pocas lineas, y si la base no esta disponible delega con next() al
// archivo que emite el build (src/pages/api/analytics.ts).
//
// Mismo patron que functions/llms.txt.js y functions/pages/[slug].js:
// hosting con funciones (self-host, Cloudflare Pages) lee la base;
// GitHub Pages se queda con el build, donde el operador puede fijar la
// config con PORTALESS_ANALYTICS_* antes de construir.
//
// Nota de rutas: el asset vive en /api/analytics (sin extension) porque
// el runtime de functions recorta el ".js" del nombre del archivo al
// armar la ruta -- un functions/analytics.js habria quedado registrado en
// /analytics y NUNCA habria interceptado el <script src="/api/analytics">.
// En el build, src/pages/api/analytics.ts emite dist/api/analytics (sin
// extension): en GitHub Pages ese archivo se sirve como
// application/octet-stream, pero el <script> es clasico (no module), que
// se ejecuta aunque el MIME no sea javascript mientras no venga con
// nosniff. Con functions el content-type sale correcto de todas formas.
//
// Seguridad: el admin solo guarda proveedor + id + origen https, nunca
// JavaScript. El emisor construye el <script> con esos datos (ver
// buildAnalyticsJs), de modo que no hay forma de inyectar sentencias.

import {
  createSiteSettingsStore,
  getAnalyticsSettings,
  buildAnalyticsJs,
} from "../../packages/dashboard/src/site-settings/site-settings-store.ts";

export async function onRequestGet(context) {
  const { env, next } = context;

  let js;
  try {
    const store = await createSiteSettingsStore(env);
    js = buildAnalyticsJs(await getAnalyticsSettings(store));
  } catch {
    // Sin base de datos o error de lectura: el build estatico manda.
    return next();
  }

  return new Response(js, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
