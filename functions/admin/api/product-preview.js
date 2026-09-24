// Endpoint de vista previa de productos para el ProductGrid del editor
// visual de Atomic Elements. Mismo patron de seguridad que
// functions/admin/permissions/index.js: requiere sesion valida
// (context.data.user, expuesta por functions/admin/_middleware.js).
// Solo lectura (GET) -- no hay operacion de escritura, asi que no
// requiere canWrite(role) adicional, solo sesion activa.
//
// Por que existe este endpoint en vez de que el editor importe
// directo packages/atomic-elements/src/elements/registry.ts:
// ProductGrid.renderHTMLAsync() (la funcion que YA CONECTA a
// Medusa/Mercur, ver ROADMAP.md "Funcionalidades en Produccion")
// importa "../../../../src/commerce/medusa-client" con una ruta
// relativa que asume ejecucion server-side dentro del monorepo. El
// editor visual (public/editor/) corre como bundle en el navegador del
// admin -- ese import no resuelve igual ahi, y ademas las credenciales
// de Medusa (src/commerce/config.ts) no deben viajar al cliente. Este
// endpoint corre server-side (mismo origen que el resto de /admin/*,
// sin friccion de CORS) y reutiliza la MISMA funcion renderHTMLAsync ya
// probada en produccion, evitando una segunda implementacion del
// fetch/formateo de precio que pueda divergir con el tiempo.
//
// GET /admin/api/product-preview?columns=3&limit=6
// Devuelve { html: string } -- el mismo HTML que renderHTMLAsync ya
// genera para el build de produccion, listo para inyectar en el
// esqueleto del editor.

import { elementRegistry } from "../../../packages/atomic-elements/src/elements/registry.ts";

export async function onRequestGet(context) {
  const { data, request } = context;

  if (!data?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const columns = Number(url.searchParams.get("columns")) || 3;
  const limit = Number(url.searchParams.get("limit")) || 6;

  if (!Number.isFinite(columns) || columns < 1 || !Number.isFinite(limit) || limit < 1) {
    return new Response(
      JSON.stringify({ error: "invalid_query", message: "columns y limit deben ser numeros positivos." }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const productGrid = elementRegistry.ProductGrid;
  if (!productGrid?.renderHTMLAsync) {
    return new Response(
      JSON.stringify({ error: "not_configured", message: "ProductGrid.renderHTMLAsync no esta disponible." }),
      { status: 501, headers: { "content-type": "application/json" } }
    );
  }

  const html = await productGrid.renderHTMLAsync({ source: "medusa", columns, limit });

  return new Response(JSON.stringify({ html }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
