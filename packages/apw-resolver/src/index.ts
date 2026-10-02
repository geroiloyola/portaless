// Resolver de alto nivel de Protocol APW: combina la lectura DNS-TXT
// (dns-txt.ts) con el parseo/validacion del manifiesto (manifest.ts) para
// dar una unica funcion de entrada: "dado un dominio, dime si publica un
// manifiesto APW valido, y cual es".
//
// APW v1.2 (seccion 5.1): resolveApwIdentity() ademas verifica la
// identidad del sitio por dos canales que deben coincidir -- la huella `k`
// del TXT (DNS, raiz de confianza) y el documento /.well-known/did.json
// (HTTPS). Si no coinciden, la identidad es invalida.
//
// Este es el punto de entrada que usara Portaless Index (pendiente, ver
// ROADMAP.md) y cualquier agente externo que quiera verificar la identidad
// APW de un sitio sin conocer los detalles de DNS-over-HTTPS.

import { resolveApwTxtRecord, type DnsTxtLookupReason } from "./dns-txt/dns-txt";
import { parseApwManifest, type ApwManifest, type ApwManifestValidationError } from "./manifest";
import { parseApwDidDocument } from "./did-apw/document";
import { jwkThumbprint } from "./did-apw/fingerprint";
import type { ApwDidDocument } from "./did-apw/types";

export type ApwResolutionReason = DnsTxtLookupReason | ApwManifestValidationError | "no_valid_manifest_found";

export interface ApwResolutionResult {
  resolved: boolean;
  reason: ApwResolutionReason;
  manifest?: ApwManifest;
  domain: string;
}

/**
 * Resuelve el manifiesto APW de un dominio. Si el TXT record tiene
 * multiples registros (por ejemplo, un sitio publicando temporalmente dos
 * versiones), se queda con el primero que parsee como manifiesto valido --
 * no es un error tener TXT records ajenos al protocolo APW conviviendo en
 * el mismo prefijo, simplemente se ignoran.
 */
export async function resolveApwManifest(
  domain: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApwResolutionResult> {
  const lookup = await resolveApwTxtRecord(domain, fetchImpl);

  if (!lookup.resolved) {
    return { resolved: false, reason: lookup.reason, domain };
  }

  let lastError: ApwManifestValidationError = "not_an_object" as ApwManifestValidationError;
  for (const record of lookup.records) {
    const parsed = parseApwManifest(record.value);
    if (parsed.valid && parsed.manifest) {
      return { resolved: true, reason: "ok" as ApwResolutionReason, manifest: parsed.manifest, domain };
    }
    if (parsed.error) lastError = parsed.error;
  }

  return { resolved: false, reason: lookup.records.length > 0 ? lastError : "no_valid_manifest_found", domain };
}

export type ApwIdentityReason =
  | ApwResolutionReason
  | "manifest_without_key"
  | "did_document_unreachable"
  | "invalid_did_document"
  | "did_mismatch"
  | "key_mismatch";

export interface ApwIdentityResult {
  verified: boolean;
  reason: ApwIdentityReason;
  domain: string;
  did?: string;
  manifest?: ApwManifest;
  didDocument?: ApwDidDocument;
  keyThumbprint?: string;
}

function normalizeDomain(domain: string): string {
  return String(domain || "").trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Verifica la identidad APW de un dominio (APW v1.2, seccion 5.1):
 * 1. El TXT `_apw.<dominio>` publica un manifiesto con la huella `k`.
 * 2. `https://<dominio>/.well-known/did.json` tiene `id: did:apw:<dominio>`.
 * 3. La huella RFC 7638 de verificationMethod[0].publicKeyJwk es igual a `k`.
 * Nunca lanza: cualquier fallo vuelve como `verified: false` con su motivo.
 */
export async function resolveApwIdentity(domain: string, fetchImpl: typeof fetch = fetch): Promise<ApwIdentityResult> {
  const host = normalizeDomain(domain);
  const did = `did:apw:${host}`;

  const resolution = await resolveApwManifest(host, fetchImpl);
  if (!resolution.resolved || !resolution.manifest) {
    return { verified: false, reason: resolution.reason, domain: host, did };
  }
  const manifest = resolution.manifest;
  if (!manifest.k) {
    return { verified: false, reason: "manifest_without_key", domain: host, did, manifest };
  }

  let didDocument: ApwDidDocument | null = null;
  try {
    const res = await fetchImpl(`https://${host}/.well-known/did.json`, {
      headers: { accept: "application/did+json, application/json" },
    });
    if (!res.ok) return { verified: false, reason: "did_document_unreachable", domain: host, did, manifest };
    didDocument = parseApwDidDocument(await res.json());
  } catch {
    return { verified: false, reason: "did_document_unreachable", domain: host, did, manifest };
  }
  if (!didDocument) return { verified: false, reason: "invalid_did_document", domain: host, did, manifest };
  if (didDocument.id !== did) return { verified: false, reason: "did_mismatch", domain: host, did, manifest, didDocument };

  let keyThumbprint: string;
  try {
    keyThumbprint = await jwkThumbprint(didDocument.verificationMethod[0].publicKeyJwk);
  } catch {
    return { verified: false, reason: "invalid_did_document", domain: host, did, manifest, didDocument };
  }
  if (keyThumbprint !== manifest.k) {
    return { verified: false, reason: "key_mismatch", domain: host, did, manifest, didDocument, keyThumbprint };
  }

  return { verified: true, reason: "ok" as ApwIdentityReason, domain: host, did, manifest, didDocument, keyThumbprint };
}

export { resolveApwTxtRecord, APW_TXT_PREFIX, DOH_ENDPOINT } from "./dns-txt/dns-txt";
export {
  buildApwManifest,
  serializeApwManifest,
  parseApwManifest,
  APW_MANIFEST_VERSION,
  APW_MANIFEST_VERSION_V2,
} from "./manifest";
export type { ApwManifest, ApwContentKind } from "./manifest";
export { jwkThumbprint, publicJwkMembers, THUMBPRINT_RE } from "./did-apw/fingerprint";
