// GET /api/setup/status -- estado minimo del primer arranque (ADR-002).
// Publico por diseno: solo expone { needsSetup, keySourceWarning }. Nunca
// codigos, hashes, usuarios, backend ni mensajes de error internos.
// En Cloudflare Pages no existe env.__PORTALESS_FIRST_RUN y responde 404.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function onRequestGet(context) {
  const firstRun = context.env?.__PORTALESS_FIRST_RUN;
  if (!firstRun || typeof firstRun.status !== "function") return json({ error: "not_found" }, 404);
  const { needsSetup, keySourceWarning } = firstRun.status();
  return json({ needsSetup: Boolean(needsSetup), keySourceWarning: Boolean(keySourceWarning) });
}
