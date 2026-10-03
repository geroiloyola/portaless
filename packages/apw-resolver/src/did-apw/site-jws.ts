// packages/apw-resolver/src/did-apw/site-jws.ts
//
// JWS firmados por ESTE sitio (APW v1.2, 5.2; ERRATA E-5). El payload se
// serializa con JCS (RFC 8785) antes de firmar, asi dos implementaciones
// producen los mismos bytes para el mismo objeto. El header lleva
// kid = did:apw:<dominio>#key-<n> (key-id.ts, ERRATA E-3).
//
// Usos:
//   - atestaciones `self` (src "self", iss = sub = did del sitio). Mismo
//     formato que las de agent/escrow_report: se verifican con
//     verifyAttestation() de trust-layer sin cambios.
//   - manifiesto firmado /.well-known/apw-manifest.jws (typ apw-manifest+jws).
//
// Solo valores I-JSON: se rechaza undefined, funciones, NaN, Infinity,
// bigint, objetos no planos y claves duplicadas no aplican (objetos JS).

import canonicalize from "canonicalize";
import { parseDidKeyId } from "./key-id";

export const ATTESTATION_TYP = "apw-attestation+jws";
export const MANIFEST_TYP = "apw-manifest+jws";

export interface SiteSigningKey {
  /** did:apw:<dominio>#key-<n> */
  keyId: string;
  privateKeyJwk: JsonWebKey;
}

export type SiteJwsFailure =
  | "malformed_jws"
  | "unsupported_alg"
  | "invalid_typ"
  | "kid_mismatch"
  | "unsupported_key"
  | "bad_signature"
  | "not_canonical";

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Lanza "not_i_json:<ruta>" si el valor no es representable en I-JSON. */
export function assertIJson(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not_i_json:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertIJson(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error(`not_i_json:${path}`);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertIJson(v, `${path}.${k}`);
    return;
  }
  throw new Error(`not_i_json:${path}`);
}

/** Serializacion JCS (RFC 8785). */
export function jcs(value: unknown): string {
  assertIJson(value);
  const out = canonicalize(value);
  if (typeof out !== "string") throw new Error("not_i_json:$");
  return out;
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new Error("unsupported_key");
  }
  return crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d } as JsonWebKey, { name: "Ed25519" }, false, ["sign"]);
}

/** Firma payload (JCS) con la clave del sitio. Devuelve JWS compacto. */
export async function signSiteJws(payload: Record<string, unknown>, key: SiteSigningKey, typ: string): Promise<string> {
  if (!parseDidKeyId(key.keyId)) throw new Error("invalid_key_id");
  const header = { alg: "EdDSA", kid: key.keyId, typ };
  const enc = new TextEncoder();
  const signingInput = `${bytesToB64Url(enc.encode(jcs(header)))}.${bytesToB64Url(enc.encode(jcs(payload)))}`;
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await importPrivate(key.privateKeyJwk), enc.encode(signingInput));
  return `${signingInput}.${bytesToB64Url(new Uint8Array(sig))}`;
}

export type VerifySiteJwsResult =
  | { ok: true; header: Record<string, unknown>; payload: Record<string, unknown> }
  | { ok: false; reason: SiteJwsFailure };

/**
 * Verifica un JWS del sitio contra una clave publica concreta (la de keyId,
 * tomada de site_identity_keys o del did.json). Exige que el payload este
 * en forma JCS: un emisor que no canonicaliza no cumple E-5. Nunca lanza.
 */
export async function verifySiteJws(
  jws: unknown,
  publicKeyJwk: JsonWebKey | null | undefined,
  expected: { kid: string; typ: string }
): Promise<VerifySiteJwsResult> {
  const fail = (reason: SiteJwsFailure): VerifySiteJwsResult => ({ ok: false, reason });
  if (typeof jws !== "string" || jws.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) {
    return fail("malformed_jws");
  }
  const [h, p, s] = jws.split(".");
  let header: unknown;
  let payload: unknown;
  let payloadText: string;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    header = JSON.parse(dec.decode(b64UrlToBytes(h)));
    payloadText = dec.decode(b64UrlToBytes(p));
    payload = JSON.parse(payloadText);
  } catch {
    return fail("malformed_jws");
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(header) || !isObj(payload)) return fail("malformed_jws");
  if (header.alg !== "EdDSA") return fail("unsupported_alg");
  if (header.typ !== expected.typ) return fail("invalid_typ");
  if (header.kid !== expected.kid) return fail("kid_mismatch");
  if (!publicKeyJwk || publicKeyJwk.kty !== "OKP" || publicKeyJwk.crv !== "Ed25519" || typeof publicKeyJwk.x !== "string") {
    return fail("unsupported_key");
  }
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: publicKeyJwk.x } as JsonWebKey, { name: "Ed25519" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64UrlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    ok = false;
  }
  if (!ok) return fail("bad_signature");
  try {
    if (jcs(payload) !== payloadText) return fail("not_canonical");
  } catch {
    return fail("not_canonical");
  }
  return { ok: true, header, payload };
}

/** Atestacion `self` (5.3): la firma el propio sitio, iss = sub = su DID. */
export async function signSelfAttestation(
  input: { did: string; category: string; value: boolean; iat?: number; jti?: string },
  key: SiteSigningKey
): Promise<{ jws: string; jti: string }> {
  const parsed = parseDidKeyId(key.keyId);
  if (!parsed || parsed.did !== input.did) throw new Error("key_id_not_for_did");
  const jti = input.jti ?? crypto.randomUUID();
  const claims = {
    typ: ATTESTATION_TYP,
    iss: input.did,
    sub: input.did,
    src: "self",
    cat: input.category,
    val: input.value,
    iat: input.iat ?? Math.floor(Date.now() / 1000),
    jti,
  };
  return { jws: await signSiteJws(claims, key, ATTESTATION_TYP), jti };
}

/** Payload del manifiesto firmado: manifiesto v2 + did + iat. */
export async function signSiteManifest(
  manifest: Record<string, unknown>,
  did: string,
  key: SiteSigningKey,
  iat: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const parsed = parseDidKeyId(key.keyId);
  if (!parsed || parsed.did !== did) throw new Error("key_id_not_for_did");
  return signSiteJws({ ...manifest, did, iat }, key, MANIFEST_TYP);
}
