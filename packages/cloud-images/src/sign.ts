// packages/cloud-images/src/sign.ts
//
// Firma y verificacion del sidecar de imagen. Reusa el JWS del sitio de
// apw-resolver (signSiteJws/verifySiteJws: JCS RFC 8785 + Ed25519, typ
// distinto por artefacto -- aca "apw-image+jws"), asi la cadena de
// custodia es la misma que la de manifiestos y atestaciones.
//
// La verificacion recibe las CLAVES candidatas (ya resueltas por quien
// llama): localmente las de site_identity (listKeys, sobrevive a
// rotaciones); remotamente las del registro APW (historial encadenado o
// did.json -- ver verify-remote.ts). Elegir la clave por el kid del
// header y despues verificar firma + igualdad canonica del payload.

import {
  signSiteJws,
  verifySiteJws,
  jcs,
  type SiteSigningKey,
  type SiteJwsFailure,
} from "../../apw-resolver/src/did-apw/site-jws";
import { jwkThumbprint } from "../../apw-resolver/src/did-apw/fingerprint";
import { parseDidKeyId } from "../../apw-resolver/src/did-apw/key-id";
import type { CloudImagePayload, CloudImageSidecar } from "./payload";

export const IMAGE_TYP = "apw-image+jws";

export interface DecodedJwsHeader {
  alg: string;
  kid: string;
  typ: string;
}

/** Firma un payload con la clave del sitio. Lanza si el keyId no es un
 *  did:apw valido (mismo contrato que signSiteJws). */
export async function signCloudImage(payload: CloudImagePayload, key: SiteSigningKey): Promise<string> {
  return signSiteJws(payload as unknown as Record<string, unknown>, key, IMAGE_TYP);
}

function b64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Decodifica el header del JWS sin verificar (para elegir clave). */
export function decodeJwsHeader(jws: unknown): DecodedJwsHeader | null {
  if (typeof jws !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) return null;
  try {
    const header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64UrlToBytes(jws.split(".")[0])));
    if (!header || typeof header !== "object" || Array.isArray(header)) return null;
    const { alg, kid, typ } = header as Record<string, unknown>;
    if (typeof alg !== "string" || typeof kid !== "string" || typeof typ !== "string") return null;
    return { alg, kid, typ };
  } catch {
    return null;
  }
}

export interface VerificationKey {
  /** did:apw:<dominio>#key-<n> (o null en claves antiguas). */
  keyId?: string | null;
  /** Huella RFC 7638 (alias historico del kid). */
  kid?: string | null;
  publicKeyJwk: JsonWebKey;
  /** Proveniencia para el reporte: "identity" | "history" | "did.json". */
  source?: string;
}

export type CloudImageVerifyFailure = "malformed_sidecar" | "header_invalid" | "kid_did_mismatch" | "key_not_found" | "payload_mismatch" | SiteJwsFailure;

export type CloudImageVerifyResult =
  | { ok: true; payload: CloudImagePayload; header: DecodedJwsHeader; key: VerificationKey }
  | { ok: false; reason: CloudImageVerifyFailure };

async function keyMatchesKid(key: VerificationKey, kid: string): Promise<boolean> {
  if (key.keyId && key.keyId === kid) return true;
  if (key.kid && key.kid === kid) return true;
  try {
    if ((await jwkThumbprint(key.publicKeyJwk)) === kid) return true;
  } catch {
    /* clave sin forma valida de huella: no matchea, no rompe */
  }
  return false;
}

/**
 * Verifica un sidecar contra un juego de claves candidatas: el kid del
 * header debe corresponder a UNA de las claves (o su huella), la firma
 * Ed25519 debe validar con ella (typ apw-image+jws, payload JCS) y el
 * payload del sidecar debe ser canonica-mente identico al firmado.
 * Nunca lanza.
 */
export async function verifyCloudImageSidecar(
  sidecar: unknown,
  keys: ReadonlyArray<VerificationKey>
): Promise<CloudImageVerifyResult> {
  const parsed = sidecar as { payload?: unknown; jws?: unknown } | null;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.jws !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.jws) ||
    parsed.payload === undefined
  ) {
    return { ok: false, reason: "malformed_sidecar" };
  }
  const header = decodeJwsHeader(parsed.jws);
  if (!header) return { ok: false, reason: "header_invalid" };

  let key: VerificationKey | undefined;
  for (const candidate of keys) {
    if (await keyMatchesKid(candidate, header.kid)) {
      key = candidate;
      break;
    }
  }
  if (!key) return { ok: false, reason: "key_not_found" };

  const verified = await verifySiteJws(parsed.jws, key.publicKeyJwk, { kid: header.kid, typ: IMAGE_TYP });
  if (!verified.ok) return { ok: false, reason: verified.reason };

  let matches = false;
  try {
    matches = jcs(parsed.payload) === jcs(verified.payload);
  } catch {
    matches = false;
  }
  if (!matches) return { ok: false, reason: "payload_mismatch" };

  const payload = verified.payload as unknown as CloudImagePayload;
  return { ok: true, payload, header, key };
}

/** El kid del header pertenece al did esperado (defensa contra un sidecar
 *  firmado por OTRO sitio re-etiquetado con el siteDid que queremos). */
export function imageKidBelongsToDid(kid: string, siteDid: string): boolean {
  const parsed = parseDidKeyId(kid);
  return parsed !== null && parsed.did === siteDid;
}
