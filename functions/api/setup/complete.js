// POST /api/setup/complete -- crea el PRIMER admin con un setup code de un solo uso.
// Body: { code, username, password }
//
// Reemplaza la politica "cero endpoints de creacion de admin" (ADR-002) solo
// para self-hosted Node. Las garantias viven en server/first-run.mjs: hash,
// 60 minutos, 5 intentos, un solo uso y bloqueo si ya existe algun usuario.
// En Cloudflare Pages no existe env.__PORTALESS_FIRST_RUN y responde 404:
// D1 sigue usando exclusivamente `npm run setup:d1`.

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const firstRun = env?.__PORTALESS_FIRST_RUN;
  if (!firstRun || typeof firstRun.complete !== "function") return json({ error: "not_found" }, 404);

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ success: false, error: "cross_origin_forbidden" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "invalid_json_body" }, 400);
  }
  const result = await firstRun.complete({ code: body?.code, username: body?.username, password: body?.password });
  return json(result.body, result.status);
}
