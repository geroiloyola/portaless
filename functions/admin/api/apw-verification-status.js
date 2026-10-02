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
// record ahi, esa es la senal de propiedad real que Protocol APW define.
//
// v0.0.9.30: ademas devuelve `txtRecord` ({ name, value, bytes }): el
// registro exacto que el usuario tiene que pegar en su proveedor de DNS,
// generado con buildApwManifest()/serializeApwManifest() -- las mismas
// funciones que usa packages/apw-resolver/src/dnslink/cli.mjs. Antes esto
// solo se podia obtener corriendo el CLI a mano, lo que dejaba afuera a
// un usuario no tecnico. `withinLimit` avisa si el valor supera los
// ~512 bytes practicos de una respuesta DNS (mismo limite que valida el CLI).
//
// APW v1.2 (B2): si el sitio ya tiene identidad did:apw, el TXT sugerido es
// un manifiesto v2 con la huella `k` de su clave, y la respuesta agrega
// `identity` con el resultado de resolveApwIdentity() (TXT + did.json). Si
// no hay identidad, todo sigue igual que antes (manifiesto v1).
//
// Diseno deliberado: esto NUNCA bloquea nada. Si el DNS no propago todavia
// (puede tardar minutos u horas), el sitio sigue funcionando exactamente
// igual -- el checklist es informativo, no un gate.
import {
  resolveApwManifest,
  resolveApwIdentity,
  buildApwManifest,
  serializeApwManifest,
  jwkThumbprint,
  APW_TXT_PREFIX,
} from "../../../packages/apw-resolver/src/index";
import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";

const TXT_PRACTICAL_LIMIT_BYTES = 512;
const SITE_ID = "default";

function requireAdmin(context) {
  // Mismo contrato que el resto de /admin: _middleware.js expone context.data.user.
  const user = context.data?.user;
  if (!user) return { error: json({ error: "No autenticado" }, 401) };
  return { user };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function buildSuggestedTxtRecord(domain, k) {
  const value = serializeApwManifest(
    buildApwManifest({ siteId: domain, contentKinds: ["mixed"], ...(k ? { k } : {}) })
  );
  const bytes = new TextEncoder().encode(value).length;
  return {
    name: `${APW_TXT_PREFIX}.${domain}`,
    type: "TXT",
    value,
    bytes,
    withinLimit: bytes <= TXT_PRACTICAL_LIMIT_BYTES,
  };
}

async function loadKeyThumbprint(env) {
  try {
    const store = await createSiteIdentityStore(env);
    const identity = await store.get(SITE_ID);
    if (!identity) return null;
    return { did: identity.did, k: await jwkThumbprint(identity.publicKeyJwk) };
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const g = requireAdmin(context);
  if (g.error) return g.error;

  const domain = new URL(context.request.url).hostname;
  const result = await resolveApwManifest(domain);
  const local = await loadKeyThumbprint(context.env);
  const identity = local ? await resolveApwIdentity(domain) : null;

  return json({
    domain,
    verified: result.resolved,
    reason: result.reason,
    manifest: result.manifest ?? null,
    txtRecord: buildSuggestedTxtRecord(domain, local?.k),
    identity: local
      ? {
          did: local.did,
          k: local.k,
          verified: identity?.verified ?? false,
          reason: identity?.reason ?? null,
        }
      : null,
  });
}
