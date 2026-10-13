// Portaless — Cloudflare "dispatcher" Worker para Workers for Platforms.
//
// Este Worker es la pieza de infraestructura que el adaptador
// CloudflareWorkersForPlatformsAdapter asume pero NO despliega (ver la
// nota de infraestructura al inicio de
// packages/plugin-sandbox/src/adapters/cloudflare-workers-for-platforms.ts):
// Cloudflare no expone un endpoint HTTP publico por-script dentro de un
// dispatch namespace; toda invocacion de un Dynamic Worker pasa por un
// Worker fijo por namespace que resuelve el script con
// `env.DISPATCH_NAMESPACE.get(scriptName)` y reenvia la request.
//
// Contrato con el adaptador (convencion, no impuesta por Cloudflare):
//   - El adaptador hace POST a la URL publica de este Worker.
//   - Header `x-portaless-script-name`: nombre del script dinamico a
//     invocar (el mismo que el PUT de upload registro en el namespace).
//   - Body: JSON con el payload del plugin.
//   - Espera JSON con `__portalessOutput` o `__portalessError` (el
//     bootstrap del script dinamico envuelve la respuesta asi).
//
// SEGURIDAD — este Worker es un punto critico:
//   1. Es una URL publica que puede invocar CUALQUIER script del
//      namespace. Se protege con un secreto compartido: el header
//      `x-portaless-dispatch-token` debe igualar `DISPATCH_TOKEN` (env
//      var del Worker). Sin el token: 401. El adaptador lo pasa via
//      config `dispatcherToken` (o no lo pasa aun -- ver TODO abajo).
//   2. El nombre de script se valida contra el patron del adaptador
//      (minusculas, digitos, guiones; max 63) para que un header
//      manipulado no pueda resolver rutas arbitrarias.
//   3. Solo POST: el dispatcher no es un CDN ni un endpoint de lectura.
//
// DESPLIEGUE (una vez por namespace, no por plugin):
//   cd infra/cloudflare/dispatcher
//   npx wrangler deploy
// (requiere wrangler login o CLOUDFLARE_API_TOKEN; ver README.md)

const SCRIPT_NAME_PATTERN = /^[a-z0-9-]{1,63}$/;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ __portalessError: "Dispatcher solo acepta POST." }, 405);
    }

    // 1. Secreto compartido: sin el, cualquiera que descubra la URL podria
    //    invocar scripts del namespace.
    const token = request.headers.get("x-portaless-dispatch-token");
    if (!env.DISPATCH_TOKEN || !token || token !== env.DISPATCH_TOKEN) {
      return json({ __portalessError: "Dispatcher token invalido." }, 401);
    }

    // 2. Nombre de script con el mismo sanitizado del adaptador.
    const scriptName = (request.headers.get("x-portaless-script-name") || "").trim().toLowerCase();
    if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
      return json({ __portalessError: "Nombre de script invalido." }, 400);
    }

    // 3. Resolver y reenviar al Dynamic Worker.
    let worker;
    try {
      worker = await env.DISPATCH_NAMESPACE.get(scriptName);
    } catch (err) {
      return json({ __portalessError: `No existe el script "${scriptName}" en el namespace: ${err instanceof Error ? err.message : String(err)}` }, 404);
    }
    if (!worker) {
      return json({ __portalessError: `Script "${scriptName}" no encontrado en el namespace.` }, 404);
    }

    try {
      // Reenvia la MISMA request (method, headers, body) al script
      // dinamico; su bootstrap responde { __portalessOutput | __portalessError }.
      const response = await worker.fetch(request);
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return json({ __portalessError: `Error invocando "${scriptName}": ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
