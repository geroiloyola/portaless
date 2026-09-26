// Endpoint de vista previa de productos para el ProductGrid del editor
// visual de Atomic Elements (src/pages/admin/editor.astro). Mismo patron de
// seguridad que functions/admin/permissions/index.js: requiere sesion valida
// (context.data.user, expuesta por functions/admin/_middleware.js).
// Solo lectura (GET) -- no requiere canWrite(role), solo sesion activa.
//
// Por que existe en vez de que el editor importe registry.ts directo:
// ProductGrid.renderHTMLAsync() importa src/commerce/medusa-client con una
// ruta que asume ejecucion server-side, y las credenciales de Medusa
// (src/commerce/config.ts) no deben viajar al navegador. Este endpoint
// reutiliza la MISMA funcion renderHTMLAsync del build de produccion.
//
// GET /admin/api/product-preview?columns=3&limit=6 -> { html: string }
//
// v0.0.9.28: columns y limit deben ser enteros positivos (2.5, abc o 0 -> 400)
// y se topean en MAX_COLUMNS / MAX_LIMIT. Antes ?limit=100000 le pedia
// 100000 productos a Medusa en cada vista previa del editor.

import { elementRegistry } from "../../../packages/atomic-elements/src/elements/registry.ts";

export const MAX_COLUMNS = 6;
export const MAX_LIMIT = 24;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// null/"" -> valor por defecto; no entero o < 1 -> NaN; > max -> max.
function parsePositiveInt(raw, fallback, max) {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return NaN;
  const n = Number(raw);
  if (n < 1) return NaN;
  return Math.min(n, max);
}

export async function onRequestGet(context) {
  const { data, request } = context;

  if (!data?.user) {
    return json({ error: "unauthenticated" }, 401);
  }

  const url = new URL(request.url);
  const columns = parsePositiveInt(url.searchParams.get("columns"), 3, MAX_COLUMNS);
  const limit = parsePositiveInt(url.searchParams.get("limit"), 6, MAX_LIMIT);

  if (Number.isNaN(columns) || Number.isNaN(limit)) {
    return json({ error: "invalid_query", message: "columns y limit deben ser enteros positivos." }, 400);
  }

  const productGrid = elementRegistry.ProductGrid;
  if (!productGrid?.renderHTMLAsync) {
    return json({ error: "not_configured", message: "ProductGrid.renderHTMLAsync no esta disponible." }, 501);
  }

  const html = await productGrid.renderHTMLAsync({ source: "medusa", columns, limit });
  return json({ html });
}
