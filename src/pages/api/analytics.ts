// GET /api/analytics -- el script de analytics del sitio, emitido en BUILD.
// Es el equivalente al /api/site-skin de Phase 0 para hosting estatico sin
// functions (GitHub Pages): un archivo fisico en dist/ que el <head> de
// BaseLayout pide siempre. En self-host y Cloudflare Pages lo reemplaza en
// runtime functions/api/analytics.js, que lee la tabla site_settings (lo que el
// admin configuro en /admin/analytics) -- mismo patron de fallback que
// functions/paginas/[slug].js.
//
// Configuracion en build via variables de entorno (para el operador que no
// tiene functions, o que quiere la config fija antes de publicar):
//   PORTALESS_ANALYTICS_PROVIDER = none | plausible | cloudflare | umami | custom
//   PORTALESS_ANALYTICS_ID       = id del sitio en el proveedor
//   PORTALESS_ANALYTICS_SCRIPT_URL = solo para provider=custom
// Sin nada configurado se emite un no-op de una linea: el request existe,
// pero no carga nada de terceros.
//
// Seguridad: mismo sanitizeAnalyticsInput que en el endpoint admin -- un
// valor invalido no se emite, se ignora (no hay panel en build).

import type { APIRoute } from "astro";
import {
  buildAnalyticsJs,
  parseAnalyticsSettings,
} from "../../../packages/dashboard/src/site-settings/analytics-config";

export const GET: APIRoute = () => {
  const settings = parseAnalyticsSettings({
    analytics_provider: process.env.PORTALESS_ANALYTICS_PROVIDER || "",
    analytics_id: process.env.PORTALESS_ANALYTICS_ID || "",
    analytics_script_url: process.env.PORTALESS_ANALYTICS_SCRIPT_URL || "",
  });

  return new Response(buildAnalyticsJs(settings), {
    headers: { "Content-Type": "text/javascript; charset=utf-8" },
  });
};
