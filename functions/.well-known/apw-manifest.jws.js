// GET /.well-known/apw-manifest.jws -- manifiesto extendido firmado por el
// sitio (APW v1.2, seccion 5.2, cierra B3).
//
// JWS compacto (RFC 7515), alg EdDSA, kid did:apw:<dominio>#key-<n> (E-3),
// payload JCS (RFC 8785, E-5). Payload = los mismos campos que el TXT
// sugerido (buildSiteManifest: v, siteId, trustUrl, contentKinds, k, h)
// + did + iat. Un resolver verifica:
//   1. la firma con la clave de did.json cuyo id es el kid;
//   2. que la huella RFC 7638 de esa clave sea `k` del TXT _apw.<dominio>;
//   3. que siteId/trustUrl/contentKinds/k coincidan con el TXT.
// `h` puede ser mas nuevo que el del TXT: el historial avanza con cada
// atestacion y el TXT solo se actualiza cuando el admin lo vuelve a pegar.
//
// Se firma en cada request (Ed25519 es barato) para que `h` e `iat` esten
// al dia; cache corta. Ruta publica: /.well-known/* ya pasa sin firma por
// isPublicBotRoute(). Sin identidad responde 404, como did.json.

import { createSiteIdentityStore, createAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { buildSiteManifest } from "../../packages/apw-resolver/src/did-apw/site-manifest.ts";
import { signSiteManifest } from "../../packages/apw-resolver/src/did-apw/site-jws.ts";

const SITE_ID = "default";

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function loadHistoryHead(env) {
  try {
    const log = await createAttestationLogStore(env);
    const head = await log.head(SITE_ID);
    return head ? head.entryHash : null;
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const store = await createSiteIdentityStore(env);
  const identity = await store.get(SITE_ID);
  if (!identity) return json({ error: "site_identity_not_found" }, 404);

  let key;
  try {
    key = await store.getActiveSigningKey(SITE_ID);
  } catch {
    key = null;
  }
  if (!key) return json({ error: "signing_key_unavailable" }, 503);

  const domain = new URL(request.url).hostname;
  const h = await loadHistoryHead(env);
  const manifest = buildSiteManifest(domain, key.kid, h);

  let jws;
  try {
    jws = await signSiteManifest(manifest, identity.did, { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk });
  } catch (err) {
    console.warn(`[Portaless APW] No se pudo firmar el manifiesto: ${err?.message}`);
    return json({ error: "manifest_signing_failed" }, 500);
  }

  return new Response(jws, {
    status: 200,
    headers: {
      "content-type": "application/jose",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
