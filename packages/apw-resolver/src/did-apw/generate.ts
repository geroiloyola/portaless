// packages/apw-resolver/src/did-apw/generate.ts
//
// Generacion de un par de claves Ed25519 nuevo para did:apw:<dominio>.
// HALLAZGO de esta sesion: no existia ninguna funcion en el repo que
// generara un par de claves nuevo para que un sitio se identifique a si
// mismo -- packages/trust-layer/src/webbotauth/ solo VERIFICA firmas
// entrantes de agentes (verify.ts) y lee directorios de claves remotos
// (key-directory.ts). Esta es la primera pieza de generacion real.
//
// Mismo primitivo criptografico que ya usa el resto del repo
// (crypto.subtle.generateKey({name: "Ed25519"}, ...) -- ver
// tests/unit/webbotauth-verify.test.ts, funcion generateKeyPair() del
// helper de test) y el mismo patron que documenta VeraDID en su flujo
// de registro client-side: la clave privada se genera y se exporta en
// el mismo paso, sin que ningun servidor la reciba todavia en ese punto.
//
// Runtime: Web Crypto API (globalThis.crypto.subtle) -- disponible tanto
// en el navegador como en Cloudflare Pages Functions / Workers, sin
// dependencias nuevas.

import { buildDidDocument } from "./document";
import type { ApwKeyPair } from "./types";

/**
 * Genera un par de claves Ed25519 nuevo y construye el did:apw
 * correspondiente al dominio dado. No persiste nada -- quien invoca
 * esta funcion decide donde guardar publicKeyJwk (tabla site_identity,
 * TXT record via manifest.ts) y que hacer con privateKeyJwk (mostrarla
 * una vez al usuario, como ya hace authorized-escrow-providers.js con
 * su apiKey en texto plano).
 *
 * @param domain dominio del sitio, sin protocolo ni path (ej. "tudominio.com")
 */
export async function generateApwDid(domain: string): Promise<ApwKeyPair> {
  if (!domain || typeof domain !== "string") {
    throw new Error("generateApwDid: se requiere un dominio valido (string no vacio).");
  }

  const normalizedDomain = domain.trim().toLowerCase();
  const did = `did:apw:${normalizedDomain}`;

  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true, // exportable -- necesario para poder mostrar/exportar la clave privada
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
  ]);

  const didDocument = buildDidDocument(did, publicKeyJwk);

  return { did, domain: normalizedDomain, publicKeyJwk, privateKeyJwk, didDocument };
}
