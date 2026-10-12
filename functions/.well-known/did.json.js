// GET /.well-known/did.json -- documento DID publico del sitio (APW v1.2,
// seccion 5.1, cierra B1).
//
// Mismo formato que un documento did:web, con id did:apw:<dominio>. La
// clave se sirve solo con sus miembros publicos obligatorios (crv, kty, x):
// nunca `d` ni la clave cifrada. La identidad la genera el Paso 4 del
// wizard (functions/admin/api/site-identity.js); si todavia no existe,
// responde 404.
//
// Un resolver solo acepta este documento si la huella RFC 7638 de la clave
// coincide con el campo `k` del TXT _apw.<dominio> (resolveApwIdentity en
// packages/apw-resolver/src/index.ts): servir este archivo desde otro host
// no suplanta la identidad, porque el DNS es la raiz de confianza.
//
// Puente opcional con AT Protocol (v0.0.9.32): si el sitio publica
// vinculos en site_atproto_links (/admin/api/apw-atproto-links), el
// documento incluye `alsoKnownAs: ["at://<handle>", ...]` -- el mismo
// campo W3C que lee el ecosistema AT. Sin vinculos el documento sale
// IDENTICO al de siempre. Si la tabla no se puede leer, se sirve el
// documento sin el campo (nunca se rompe la identidad por el puente).
//
// Ruta publica: /.well-known/* ya pasa sin firma por isPublicBotRoute().

import { createSiteIdentityStore, createSiteAtprotoLinksStore } from "../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document.ts";
import { publicJwkMembers } from "../../packages/apw-resolver/src/did-apw/fingerprint.ts";

const SITE_ID = "default";

async function loadAlsoKnownAs(env) {
  try {
    const store = await createSiteAtprotoLinksStore(env);
    const links = await store.list(SITE_ID);
    return links.map((link) => `at://${link.handle}`);
  } catch (err) {
    console.warn(`[Portaless APW] Vinculos AT ilegibles, did.json sin alsoKnownAs: ${err?.message}`);
    return [];
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const store = await createSiteIdentityStore(env);
  const identity = await store.get(SITE_ID);

  if (!identity) {
    return new Response(JSON.stringify({ error: "site_identity_not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  let publicKeyJwk;
  try {
    publicKeyJwk = publicJwkMembers(identity.publicKeyJwk);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_site_identity_key" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const alsoKnownAs = await loadAlsoKnownAs(env);
  const didDocument = buildDidDocument(identity.did, publicKeyJwk, { alsoKnownAs });
  return new Response(JSON.stringify(didDocument), {
    status: 200,
    headers: {
      "content-type": "application/did+json",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
