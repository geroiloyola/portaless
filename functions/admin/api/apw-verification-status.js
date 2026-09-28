// functions/admin/api/apw-verification-status.js
//
// Checklist diferido del dashboard (Fase 2 del onboarding, ver ROADMAP.md
// seccion "Onboarding de un click: Wizard + Checklist diferido"). Consulta
// si el dominio de ESTE sitio ya tiene publicado su registro TXT de
// Protocol APW, via resolveApwManifest() (ya implementado en
// packages/apw-resolver, DNS-over-HTTPS real contra Cloudflare 1.1.1.1).
//
// "Verificado" aqui significa unicamente: existe un manifiesto APW valido
// en el TXT record _apw.<dominio> de la URL con la que se sirvio esta
// request. No compara contra un siteId esperado de antemano -- si alguien
// controla el DNS del dominio lo suficiente como para publicar un TXT
// record ahi, esa es la señal de propiedad real que Protocol APW define.
//
// Diseño deliberado: esto NUNCA bloquea nada. Si el DNS no propago todavia
// (puede tardar minutos u horas), el sitio sigue funcionando exactamente
// igual -- el checklist es informativo, no un gate. Ver la entrada
// correspondiente en ROADMAP.md sobre que pasa si nunca se completa.
import { resolveApwManifest } from "../../../packages/apw-resolver/src/index";

function requireAdmin(context) {
  // Mismo contrato que el resto de /admin: _middleware.js expone context.data.user.
  const user = context.data?.user;
  if (!user) return { error: json({ error: "No autenticado" }, 401) };
  return { user };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;

  const domain = new URL(context.request.url).hostname;
  const result = await resolveApwManifest(domain);

  return json({
    domain,
    verified: result.resolved,
    reason: result.reason,
    manifest: result.manifest ?? null,
  });
}
