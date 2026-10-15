/**
 * Manifiesto de plugin FIRMADO por su publicador (Fase 11.2, ERRATA E-15).
 *
 * Un plugin que se instala por HTTP trae codigo ejecutable. Para que lo que se
 * valido sea exactamente lo que corre, el publicador firma su manifiesto con su
 * `did:apw` y el instalador verifica la firma contra la identidad RESUELTA del
 * publicador (5.1). El `typ` es propio (`apw-plugin-manifest+jws`): un manifiesto
 * de plugin no es el manifiesto de un sitio ni una atestacion, y reusar el typ
 * los volveria indistinguibles en la verificacion.
 *
 * La firma CUBRE `requestedCapabilities`: van dentro de `manifest`, que es parte
 * del payload JCS que se firma. Si no fuera asi, un "manifiesto firmado" no
 * impediria que alguien cambiara lo que el plugin pide.
 *
 * Modulo puro (salvo crypto.subtle); sin store ni Node.
 */

import { signSiteJws, verifySiteJws, type SiteSigningKey } from "./site-jws";
import { parseDidKeyId } from "./key-id";

export const PLUGIN_MANIFEST_TYP = "apw-plugin-manifest+jws";

export interface SignedPluginCapabilityRequest {
  id: string;
  allowedHosts?: string[];
  reason: string;
}

export interface SignedPluginManifestInner {
  name: string;
  version: string;
  entry: string;
  runtime: "javascript" | "wasm";
  requestedCapabilities: SignedPluginCapabilityRequest[];
}

export interface PluginManifestDocument {
  /** did:apw del publicador; es el `iss` efectivo de la firma. */
  publisher: string;
  iat: number;
  manifest: SignedPluginManifestInner;
}

export type VerifyPluginManifestResult =
  | { ok: true; document: PluginManifestDocument }
  | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valida la forma del documento; no valida el manifiesto (eso es validateManifest). */
export function isPluginManifestDocument(v: unknown): v is PluginManifestDocument {
  if (!isPlainObject(v)) return false;
  if (typeof v.publisher !== "string" || !v.publisher.startsWith("did:apw:")) return false;
  if (typeof v.iat !== "number" || !Number.isFinite(v.iat)) return false;
  const m = v.manifest;
  if (!isPlainObject(m)) return false;
  if (typeof m.name !== "string" || typeof m.version !== "string" || typeof m.entry !== "string") return false;
  if (m.runtime !== "javascript" && m.runtime !== "wasm") return false;
  if (!Array.isArray(m.requestedCapabilities)) return false;
  return true;
}

/** Construye el payload firmable. */
export function buildPluginManifestPayload(input: {
  publisher: string;
  manifest: SignedPluginManifestInner;
  iat?: number;
}): PluginManifestDocument {
  return { publisher: input.publisher, iat: input.iat ?? Math.floor(Date.now() / 1000), manifest: input.manifest };
}

/** Firma el manifiesto con la clave del publicador (typ = apw-plugin-manifest+jws). */
export async function signPluginManifest(
  input: { publisher: string; manifest: SignedPluginManifestInner; iat?: number },
  key: SiteSigningKey
): Promise<string> {
  const parsed = parseDidKeyId(key.keyId);
  if (!parsed || parsed.did !== input.publisher) throw new Error("key_id_not_for_publisher");
  const payload = buildPluginManifestPayload(input) as unknown as Record<string, unknown>;
  return signSiteJws(payload, key, PLUGIN_MANIFEST_TYP);
}

/**
 * Verifica un manifiesto firmado contra la identidad RESUELTA del publicador.
 * `publisher` es el DID que el instalador espera (el del dominio resuelto); si
 * no coincide con el `publisher` del documento, la firma sola no basta.
 */
export async function verifyPluginManifest(
  jws: unknown,
  identity: { publicKeyJwk: JsonWebKey | null | undefined; kid: string; publisher: string }
): Promise<VerifyPluginManifestResult> {
  const verified = await verifySiteJws(jws, identity.publicKeyJwk, { kid: identity.kid, typ: PLUGIN_MANIFEST_TYP });
  if (!verified.ok) return { ok: false, reason: verified.reason };
  if (!isPluginManifestDocument(verified.payload)) return { ok: false, reason: "invalid_document" };
  if (verified.payload.publisher !== identity.publisher) return { ok: false, reason: "publisher_mismatch" };
  return { ok: true, document: verified.payload };
}
