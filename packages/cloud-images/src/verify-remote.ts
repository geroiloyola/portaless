// packages/cloud-images/src/verify-remote.ts
//
// Verificacion STANDALONE de un sidecar contra el registro APW -- el
// "C2PA sin autoridad central": cualquiera con el sidecar (y opcionalmente
// la imagen) puede verificarlo sin pedirle permiso a nadie, resolviendo
// la clave del sitio en la cadena de confianza APW:
//
//   1. El kid del header DEBE pertenecer al siteDid del payload (un
//      sidecar firmado por otro sitio no se re-etiqueta);
//   2. claves del historial encadenado (apw-log.json verificado contra k
//      -- incluye claves retiradas, asi una imagen firmada hace meses
//      sigue verificable despues de rotaciones); si el sitio aun no
//      tiene historial, fallback a la clave activa de did.json;
//   3. firma Ed25519 + payload JCS canonico (verifyCloudImageSidecar);
//   4. con la imagen en base64: sha256(bytes) == payload.contentHash.
//
// Todas las dependencias son inyectables (sin red real en tests).

import { resolveApwHistory } from "../../apw-resolver/src/did-apw/history-resolver";
import { resolveApwIdentity } from "../../apw-resolver/src/index";
import { parseSidecar, sha256Hash, decodeBase64, type CloudImagePayload } from "./payload";
import { decodeJwsHeader, imageKidBelongsToDid, verifyCloudImageSidecar, type VerificationKey } from "./sign";
import { isPng, stripPng } from "./png";

export interface RemoteVerifyDeps {
  resolveHistory?: (domain: string, options: { includeKeys: true }) => Promise<{
    verified: boolean;
    keys?: Array<{ kid: string; keyId?: string | null; publicKeyJwk: JsonWebKey }>;
  }>;
  resolveDid?: (domain: string, fetchImpl: typeof fetch) => Promise<{
    verified: boolean;
    did?: string;
    didDocument?: { verificationMethod?: Array<{ publicKeyJwk?: JsonWebKey }> } | null;
  }>;
  fetchImpl?: typeof fetch;
  /** Imagen opcional en base64: agrega la verificacion del contentHash. */
  imageBase64?: string;
}

export type ContentHashStatus = "match" | "mismatch" | "not_checked";

export interface RemoteVerifyResult {
  valid: boolean;
  /** Motivo raiz cuando no valido (null si solo falla el hash). */
  reason?: string;
  signature: { valid: boolean; reason?: string };
  contentHash: { status: ContentHashStatus };
  keySource?: "history" | "did.json" | "none";
  payload?: CloudImagePayload;
}

function didToDomain(siteDid: string): string | null {
  if (!siteDid.startsWith("did:apw:")) return null;
  const domain = siteDid.slice("did:apw:".length);
  return domain.length > 0 ? domain : null;
}

async function resolveKeys(
  siteDid: string,
  deps: RemoteVerifyDeps
): Promise<{ keys: VerificationKey[]; source: "history" | "did.json" | "none" }> {
  const domain = didToDomain(siteDid);
  if (!domain) return { keys: [], source: "none" };

  const resolveHistory = deps.resolveHistory ?? ((d: string, o: { includeKeys: true }) => resolveApwHistory(d, o));
  try {
    const history = await resolveHistory(domain, { includeKeys: true });
    if (history.verified && history.keys && history.keys.length > 0) {
      return {
        keys: history.keys.map((key) => ({ keyId: key.keyId ?? null, kid: key.kid, publicKeyJwk: key.publicKeyJwk, source: "history" })),
        source: "history",
      };
    }
  } catch {
    /* fallback a did.json */
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveDid = deps.resolveDid ?? ((d: string, f: typeof fetch) => resolveApwIdentity(d, f));
  try {
    const identity = await resolveDid(domain, fetchImpl);
    const method = identity.didDocument?.verificationMethod?.[0];
    if (identity.verified && identity.did === siteDid && method?.publicKeyJwk) {
      // did.json publica UNA clave (la activa) con id #key-1 aunque el kid
      // real de la clave sea #key-<n> post-rotacion: la igualdad de DID ya
      // la verifico el caller, aca entregamos la clave publica candidata.
      return { keys: [{ keyId: siteDid + "#key-1", publicKeyJwk: method.publicKeyJwk, source: "did.json" }], source: "did.json" };
    }
  } catch {
    /* sin clave */
  }
  return { keys: [], source: "none" };
}

/**
 * Verifica un sidecar desconocido. Nunca lanza: todo fallo vuelve como
 * resultado estructurado (mismo principio que resolveApwIdentity).
 * Con imageBase64 tambien verifica el hash del contenido.
 */
export async function verifySidecarRemote(sidecar: unknown, deps: RemoteVerifyDeps = {}): Promise<RemoteVerifyResult> {
  const parsed = parseSidecar(sidecar);
  if (!parsed) {
    return { valid: false, reason: "invalid_sidecar", signature: { valid: false, reason: "invalid_sidecar" }, contentHash: { status: "not_checked" } };
  }

  const header = decodeJwsHeader(parsed.jws);
  if (!header) {
    return { valid: false, reason: "header_invalid", signature: { valid: false, reason: "header_invalid" }, contentHash: { status: "not_checked" } };
  }
  if (!imageKidBelongsToDid(header.kid, parsed.payload.siteDid)) {
    return {
      valid: false,
      reason: "kid_did_mismatch",
      signature: { valid: false, reason: "kid_did_mismatch" },
      contentHash: { status: "not_checked" },
    };
  }

  const { keys, source } = await resolveKeys(parsed.payload.siteDid, deps);
  if (keys.length === 0) {
    return { valid: false, reason: "site_keys_unresolvable", signature: { valid: false, reason: "site_keys_unresolvable" }, contentHash: { status: "not_checked" }, keySource: source };
  }

  const verified = await verifyCloudImageSidecar(parsed, keys);
  if (!verified.ok) {
    return { valid: false, reason: verified.reason, signature: { valid: false, reason: verified.reason }, contentHash: { status: "not_checked" }, keySource: source };
  }

  const result: RemoteVerifyResult = {
    valid: true,
    signature: { valid: true },
    keySource: source,
    payload: verified.payload,
    contentHash: { status: "not_checked" },
  };

  if (typeof deps.imageBase64 === "string") {
    const bytes = decodeBase64(deps.imageBase64);
    let content: Uint8Array | null = bytes;
    if (bytes && isPng(bytes)) {
      // El contentHash es sobre la imagen SIN sidecar: si el PNG trae el
      // chunk pAPW embebido (lo normal en /images/:id) lo removemos antes
      // de hashear. Sin IEND valido no se puede remover -> se hashea tal cual.
      try {
        content = stripPng(bytes);
      } catch {
        content = bytes;
      }
    }
    const hash = content ? await sha256Hash(content) : null;
    const match = hash !== null && hash === verified.payload.contentHash;
    result.contentHash = { status: match ? "match" : "mismatch" };
    if (!match) {
      result.valid = false;
      result.reason = "content_hash_mismatch";
    }
  }

  return result;
}
