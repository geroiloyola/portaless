/**
 * Documento firmado de paginas publicables (Fase 9b): el artefacto que un nodo
 * publica para que otro lo lea sin depender de su base de datos.
 *
 * Por que un typ propio y no `apw-manifest+jws`: un manifiesto de sitio y un
 * documento de paginas son documentos distintos con significados distintos. Reusar
 * el typ del manifiesto los volveria indistinguibles en la verificacion y
 * confundiria la procedencia. `PAGES_TYP` es el tipo del header (ERRATA E-14).
 *
 * La FIRMA es la misma primitiva del sitio (5.2, JCS + Ed25519). El documento
 * se verifica contra la identidad RESUELTA del par (5.1: TXT `_apw` + did.json),
 * no contra un hash servido desde el mismo origen: un hash da integridad, no
 * procedencia. Este modulo no hace I/O: recibe la clave publica ya resuelta y
 * verifica. Quien resuelve y verifica la cadena es `resolvePeerPages`, que
 * combina `resolveApwIdentity` con esta funcion.
 *
 * Modulo puro (salvo crypto.subtle), sin store ni Node.
 */

import { signSiteJws, verifySiteJws, type SiteSigningKey } from "../did-apw/site-jws";
import { parseDidKeyId } from "../did-apw/key-id";
import { resolveApwIdentity } from "../index";

/** Typ del header para el documento de paginas (ERRATA E-14). */
export const PAGES_TYP = "apw-pages+jws";

/** Maximo de entradas por documento, para que un par no infle la respuesta. */
export const MAX_PAGES_ENTRIES = 200;

export interface PagesDocumentEntry {
  kind: "page" | "post";
  slug: string;
  title: string;
  /** URL absoluta o root-relativa del contenido en el sitio del par. */
  url: string;
  /** Fecha de publicacion declarada (ISO 8601). */
  publishedAt: string;
}

export interface PagesDocumentPayload {
  iss: string;
  iat: number;
  entries: PagesDocumentEntry[];
}

export type PagesDocumentFailure =
  | "malformed_jws"
  | "invalid_typ"
  | "bad_signature"
  | "not_canonical"
  | "iss_mismatch"
  | "invalid_entries"
  | "too_many_entries";

export type VerifyPagesDocumentResult =
  | { ok: true; entries: PagesDocumentEntry[] }
  | { ok: false; reason: PagesDocumentFailure };

const ENTRY_KINDS: ReadonlySet<string> = new Set(["page", "post"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valida y normaliza las entradas; lanza un reason si algo no cuadra. */
export function parsePagesEntries(raw: unknown, max = MAX_PAGES_ENTRIES): PagesDocumentEntry[] | PagesDocumentFailure {
  if (!Array.isArray(raw)) return "invalid_entries";
  if (raw.length > max) return "too_many_entries";
  const out: PagesDocumentEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return "invalid_entries";
    const { kind, slug, title, url, publishedAt } = item;
    if (typeof kind !== "string" || !ENTRY_KINDS.has(kind)) return "invalid_entries";
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) return "invalid_entries";
    if (typeof title !== "string" || title.length > 500) return "invalid_entries";
    if (typeof url !== "string" || url.length === 0 || url.length > 2000) return "invalid_entries";
    if (typeof publishedAt !== "string" || !Number.isFinite(Date.parse(publishedAt))) return "invalid_entries";
    out.push({ kind: kind as "page" | "post", slug, title, url, publishedAt });
  }
  return out;
}

/**
 * Construye el payload del documento. Determinista: ordena las entradas por
 * (kind, slug) para que el mismo conjunto produzca los mismos bytes. `jcs`
 * canonicaliza igual al firmar, pero ordenar aca evita que dos consumidores vean
 * ordenes distintos antes de comparar.
 */
export function buildPagesDocument(input: {
  did: string;
  entries: readonly PagesDocumentEntry[];
  iat?: number;
}): PagesDocumentPayload {
  const parsed = parsePagesEntries([...input.entries]);
  if (typeof parsed === "string") throw new Error(`invalid_entries:${parsed}`);
  parsed.sort((a, b) => (a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { iss: input.did, iat: input.iat ?? Math.floor(Date.now() / 1000), entries: parsed };
}

/** Firma el documento con la clave del sitio (typ = apw-pages+jws). */
export async function signPagesDocument(input: { did: string; entries: readonly PagesDocumentEntry[]; iat?: number }, key: SiteSigningKey): Promise<string> {
  const parsedKid = parseDidKeyId(key.keyId);
  if (!parsedKid || parsedKid.did !== input.did) throw new Error("key_id_not_for_did");
  return signSiteJws(buildPagesDocument(input) as unknown as Record<string, unknown>, key, PAGES_TYP);
}

/**
 * Verifica un documento contra la identidad RESUELTA del par. `publicKeyJwk` y
 * `kid` vienen de resolver el `did:apw` del par (5.1); `expectedDid` es el DID
 * que el llamador espera (el dominio del par). Sin esos datos, la firma sola no
 * dice contra quien se verifico.
 */
export async function verifyPagesDocument(
  jws: unknown,
  identity: { publicKeyJwk: JsonWebKey | null | undefined; kid: string; did: string },
  max = MAX_PAGES_ENTRIES
): Promise<VerifyPagesDocumentResult> {
  const verified = await verifySiteJws(jws, identity.publicKeyJwk, { kid: identity.kid, typ: PAGES_TYP });
  if (!verified.ok) return { ok: false, reason: verified.reason as PagesDocumentFailure };
  const payload = verified.payload;
  if (payload.iss !== identity.did) return { ok: false, reason: "iss_mismatch" };
  const entries = parsePagesEntries(payload.entries, max);
  if (typeof entries === "string") return { ok: false, reason: entries };
  return { ok: true, entries };
}

/** Extrae el `kid` del header de un JWS compacto (sin verificar). */
export function peekJwsKid(jws: string): string | null {
  try {
    const part = jws.split(".")[0];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const header = JSON.parse(atob(padded));
    return typeof header?.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

export interface PeerFetch {
  (url: string, init?: { signal?: AbortSignal }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

/**
 * Resuelve la identidad del par (5.1) y verifica su documento de paginas contra
 * ESA identidad. La URL del documento se construye desde el dominio resuelto,
 * nunca desde un href que el par controle.
 */
export async function resolvePeerPages(
  domain: string,
  fetchImpl: PeerFetch,
  max = MAX_PAGES_ENTRIES
): Promise<{ ok: true; entries: PagesDocumentEntry[] } | { ok: false; reason: string }> {
  const identity = await resolveApwIdentity(domain, fetchImpl as never);
  if (!identity.verified || !identity.didDocument) return { ok: false, reason: `identity_unresolved:${identity.reason}` };
  const vm = identity.didDocument.verificationMethod?.[0];
  const publicKeyJwk = vm?.publicKeyJwk;
  const did = identity.did;
  if (!publicKeyJwk || !did) return { ok: false, reason: "identity_without_key" };

  let res;
  try {
    res = await fetchImpl(`https://${domain}/.well-known/apw-pages.jws`, { signal: AbortSignal.timeout(10000) });
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const jws = await res.text();
  const kid = peekJwsKid(jws);
  if (!kid) return { ok: false, reason: "malformed_jws" };
  return verifyPagesDocument(jws, { publicKeyJwk, kid, did }, max);
}
