// packages/cloud-images/src/payload.ts
//
// Formato APW de metadata de imagen v1 -- el lado "datos" de Cloud Images
// + APW como SSOT criptografico (ROADMAP, "C2PA sin autoridad central").
// Un sidecar es { payload, jws }: el payload es lo que se firma (JCS
// RFC 8785, via signSiteJws de apw-resolver) y el jws es la firma Ed25519
// de la clave activa del sitio (typ apw-image+jws).
//
// El payload lleva exactamente lo que promete el alcance:
//   - contentHash: sha256 de los bytes de la imagen (sin el chunk pAPW);
//   - signedAt: timestamp de existencia criptografico -- esta DENTRO de
//     lo firmado, no es una fecha que el cliente pueda alterar;
//   - trust: la SiteTrustScore publica contemporanea (counts + proyeccion
//     solo-publica), null si no se pudo leer (nunca bloquea la firma);
//   - declaredOrigin: human | ai | mixed (declaracion del sitio; la
//     moderacion de declaraciones falsas es trabajo futuro, ver docs).
//
// Nunca lanza en parseo: parseSidecar/validatePayload devuelven null ante
// cualquier shape hostil (mismo principio defensivo que parseApwManifest).

import type { projectTrustView } from "../../apw-resolver/src/scoring/policy";

export type DeclaredOrigin = "human" | "ai" | "mixed";

export const DECLARED_ORIGINS: readonly DeclaredOrigin[] = ["human", "ai", "mixed"];

/** Teto de subida: 4 MiB. SQLite lo soporta; para produccion/imagenes
 *  grandes esta el item externo de R2 (ROADMAP External). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ImageProjection = ReturnType<typeof projectTrustView>;

/** SiteTrustScore publica capturada al momento de firmar. */
export interface ImageTrust {
  siteId: string;
  counts: { self: number; agent: number; community: number; escrowReports: number };
  projection: ImageProjection | null;
  computedAt: string;
}

export interface CloudImagePayload {
  v: 1;
  imageId: string;
  /** `sha256:<hex de 64>` de los bytes de la imagen. */
  contentHash: string;
  contentType: string;
  byteLength: number;
  declaredOrigin: DeclaredOrigin;
  /** Identidad del sitio que firma: siteId "default" + did:apw:<dominio>. */
  siteId: string;
  siteDid: string;
  signedAt: string;
  keyAlgorithm: "ed25519";
  trust: ImageTrust | null;
}

export interface CloudImageSidecar {
  payload: CloudImagePayload;
  jws: string;
}

export const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const IMAGE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const DID_APW_RE = /^did:apw:[a-z0-9.-]+$/;
const JWS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAllowedContentType(value: unknown): value is string {
  return typeof value === "string" && (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

export function isDeclaredOrigin(value: unknown): value is DeclaredOrigin {
  return typeof value === "string" && (DECLARED_ORIGINS as readonly string[]).includes(value);
}

/** sha256 de los bytes como `sha256:<hex>` (minuscules, 64 chars). */
export async function sha256Hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export function isContentHash(value: unknown): value is string {
  return typeof value === "string" && CONTENT_HASH_RE.test(value);
}

export interface BuildPayloadInput {
  imageId: string;
  contentHash: string;
  contentType: string;
  byteLength: number;
  declaredOrigin: DeclaredOrigin;
  siteId: string;
  siteDid: string;
  signedAt: string;
  trust: ImageTrust | null;
}

/** Construye el payload. Lanza si un input de confianza del servidor es
 *  invalido (el validador de parseo es validatePayload, para entradas). */
export function buildCloudImagePayload(input: BuildPayloadInput): CloudImagePayload {
  if (!IMAGE_ID_RE.test(input.imageId)) throw new Error("invalid_image_id");
  if (!isContentHash(input.contentHash)) throw new Error("invalid_content_hash");
  if (!isAllowedContentType(input.contentType)) throw new Error("invalid_content_type");
  if (!Number.isInteger(input.byteLength) || input.byteLength <= 0 || input.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("invalid_byte_length");
  }
  if (!isDeclaredOrigin(input.declaredOrigin)) throw new Error("invalid_declared_origin");
  if (typeof input.siteId !== "string" || !input.siteId) throw new Error("invalid_site_id");
  if (typeof input.siteDid !== "string" || !DID_APW_RE.test(input.siteDid)) throw new Error("invalid_site_did");
  if (typeof input.signedAt !== "string" || Number.isNaN(Date.parse(input.signedAt))) throw new Error("invalid_signed_at");
  return {
    v: 1,
    imageId: input.imageId,
    contentHash: input.contentHash,
    contentType: input.contentType,
    byteLength: input.byteLength,
    declaredOrigin: input.declaredOrigin,
    siteId: input.siteId,
    siteDid: input.siteDid,
    signedAt: input.signedAt,
    keyAlgorithm: "ed25519",
    trust: input.trust,
  };
}

function validateTrust(value: unknown): ImageTrust | null | false {
  if (value === null) return null;
  if (!isObject(value)) return false;
  const counts = value.counts;
  if (typeof value.siteId !== "string" || !isObject(counts) || typeof value.computedAt !== "string") return false;
  for (const key of ["self", "agent", "community", "escrowReports"]) {
    if (!Number.isInteger((counts as Record<string, unknown>)[key])) return false;
  }
  if (value.projection !== null && !isObject(value.projection)) return false;
  return value as unknown as ImageTrust;
}

/** Parseo defensivo de un payload. null = forma invalida (o corrupta). */
export function validatePayload(value: unknown): CloudImagePayload | null {
  if (!isObject(value)) return null;
  if (value.v !== 1) return null;
  if (typeof value.imageId !== "string" || !IMAGE_ID_RE.test(value.imageId)) return null;
  if (!isContentHash(value.contentHash)) return null;
  if (!isAllowedContentType(value.contentType)) return null;
  if (!Number.isInteger(value.byteLength) || (value.byteLength as number) <= 0 || (value.byteLength as number) > MAX_IMAGE_BYTES) {
    return null;
  }
  if (!isDeclaredOrigin(value.declaredOrigin)) return null;
  if (typeof value.siteId !== "string" || !value.siteId) return null;
  if (typeof value.siteDid !== "string" || !DID_APW_RE.test(value.siteDid)) return null;
  if (typeof value.signedAt !== "string" || Number.isNaN(Date.parse(value.signedAt))) return null;
  if (value.keyAlgorithm !== "ed25519") return null;
  const trust = validateTrust(value.trust);
  if (trust === false) return null;
  return value as unknown as CloudImagePayload;
}

/** Parseo defensivo del sidecar { payload, jws }. */
export function parseSidecar(value: unknown): CloudImageSidecar | null {
  if (!isObject(value)) return null;
  if (typeof value.jws !== "string" || !JWS_RE.test(value.jws)) return null;
  const payload = validatePayload(value.payload);
  if (!payload) return null;
  return { payload, jws: value.jws };
}

/** Decodifica base64 estricto a bytes. null si no es base64 valido. */
export function decodeBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
