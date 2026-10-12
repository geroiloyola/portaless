// packages/identity-atproto/src/resolve.ts
//
// Resolucion de identidades AT Protocol, segun los specs oficiales:
//   - Handle: https://atproto.com/specs/handle (TXT `_atproto.<handle>`
//     con valor `did=...` via DNS-over-HTTPS, y/o GET
//     `https://<handle>/.well-known/atproto-did` con el DID como body
//     text/plain). El spec prefiere TXT; si TXT y HTTPS discrepan, gana
//     TXT (o se puede marcar ambiguo -- aca gana TXT, decision explicita).
//   - DID: https://atproto.com/specs/did (did:plc via plc.directory,
//     did:web hostname-level via `https://<host>/.well-known/did.json`;
//     en AT el did:web con paths/puertos NO esta soportado).
//
// Verificacion BIDIRECCIONAL obligatoria (spec de handle): un handle no
// se confia hasta que (1) el handle resuelve a un DID y (2) el documento
// de ese DID reclama el handle via `alsoKnownAs: ["at://<handle>"]`.
// resolveAtprotoIdentity() hace las dos patas.
//
// Nada de esto inventa formato propio: se leen los mismos campos que lee
// el ecosistema AT (alsoKnownAs, verificationMethod #atproto Multikey,
// service #atproto_pds), de ahi la "compatibilidad simbiotica" con APW.
//
// Todos los fallos vuelven como resultado estructurado (nunca throw) --
// mismo principio que resolveApwIdentity() en apw-resolver.

import { parseHandle, resolvableHandle, atUriFromHandle, handleFromAtUri, RESERVED_TLDS, handleTld } from "./handle";

export const PLC_DIRECTORY_URL = "https://plc.directory";
export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** Metodos "blessed" por AT (spec de DID). */
export const BLESSSED_DID_METHODS: ReadonlySet<string> = new Set(["plc", "web"]);

export type HandleResolutionReason =
  | "ok"
  | "invalid_handle"
  | "reserved_tld"
  | "ambiguous_txt"
  | "handle_unresolvable"
  | "unsupported_did_method"
  | "response_too_large"
  | "upstream_error";

export type DidResolutionReason =
  | "ok"
  | "did_syntax_invalid"
  | "did_method_unsupported"
  | "did_web_unsupported"
  | "did_not_found"
  | "did_unreachable"
  | "did_mismatch"
  | "malformed_document"
  | "response_too_large";

export type IdentityReason =
  | HandleResolutionReason
  | DidResolutionReason
  | "link_mismatch";

export interface ResolveDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AtprotoDidDocument {
  id: string;
  alsoKnownAs?: unknown;
  verificationMethod?: unknown;
  service?: unknown;
}

export interface AtprotoSigningKey {
  id: string;
  type: string;
  /** `true` si es Multikey moderno con multicodec ed25519 (el formato actual). */
  multibase: string;
}

export interface ResolvedAtprotoIdentity {
  handle: string;
  did: string;
  didMethod: "plc" | "web";
  /** Como llegamos del handle al DID: "txt" (preferido) o "https". */
  resolvedBy: "txt" | "https";
  document: AtprotoDidDocument;
  /** Handles reclamados por el DID via alsoKnownAs (sintacticamente validos). */
  claimedHandles: string[];
  /** null = el documento no trae clave atproto valida ("likely broken" per spec). */
  signingKey: AtprotoSigningKey | null;
  /** Endpoint PDS (#atproto_pds) si esta presente. */
  pds: string | null;
}

export type ResolveHandleResult =
  | { ok: true; did: string; resolvedBy: "txt" | "https" }
  | { ok: false; reason: HandleResolutionReason };

export type ResolveDidResult =
  | { ok: true; document: AtprotoDidDocument }
  | { ok: false; reason: DidResolutionReason };

export type ResolveIdentityResult =
  | { ok: true; identity: ResolvedAtprotoIdentity }
  | { ok: false; reason: IdentityReason };

/** Syntax DID en contexto AT (spec: "reasonable starting-point regex"). */
const DID_SYNTAX = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const MAX_DID_LENGTH = 2048;
const MAX_DID_DOC_BYTES = 64 * 1024;
const MAX_HANDLE_DID_BODY_BYTES = 1024;
/** `_atproto.` son 9 chars; el query DNS total no puede pasar de 253. */
const TXT_QUERY_MAX_HANDLE = 244;

export function parseAtprotoDid(input: unknown): { ok: true; did: string; method: "plc" | "web" } | { ok: false } {
  if (typeof input !== "string" || input.length > MAX_DID_LENGTH || !DID_SYNTAX.test(input)) {
    return { ok: false };
  }
  const method = input.slice("did:".length, input.indexOf(":", "did:".length));
  if (!BLESSSED_DID_METHODS.has(method)) return { ok: false };
  return { ok: true, did: input, method: method as "plc" | "web" };
}

function isBlessedDid(input: unknown): boolean {
  return parseAtprotoDid(input).ok;
}

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/** Misma lectura de TXT multi-string que parseDohTxtData en apw-resolver (RFC 1464). */
export function parseDohTxtData(raw: string): string {
  const matches = raw.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!matches) return raw;
  return matches
    .map((segment) => segment.slice(1, -1).replace(/\\"/g, '"'))
    .join("");
}

async function readBody(response: Response, maxBytes: number): Promise<string | null> {
  const text = await response.text();
  if (text.length > maxBytes) return null;
  return text;
}

async function fetchText(
  url: string,
  deps: ResolveDeps,
  maxBytes: number,
  headers?: Record<string, string>
): Promise<{ ok: true; body: string } | { ok: false; tooLarge: boolean; networkError: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, tooLarge: false, networkError: true };
  }
  if (!response.ok) return { ok: false, tooLarge: false, networkError: false };
  try {
    const body = await readBody(response, maxBytes);
    if (body === null) return { ok: false, tooLarge: true, networkError: false };
    return { ok: true, body };
  } catch {
    return { ok: false, tooLarge: false, networkError: true };
  }
}

/**
 * Metodo TXT: `_atproto.<handle>` con valor `did=did:...` (spec). Un solo
 * DID valido distinto resuelve; multiples DID distintos = ambiguo (el
 * spec dice "resolution should fail"). DoH via Cloudflare, mismo canal
 * que ya usa apw-resolver para `_apw`.
 */
async function resolveHandleViaTxt(
  handle: string,
  deps: ResolveDeps
): Promise<{ state: "did"; did: string } | { state: "none" } | { state: "ambiguous" } | { state: "skipped" }> {
  if (handle.length > TXT_QUERY_MAX_HANDLE) return { state: "skipped" };

  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(`_atproto.${handle}`)}&type=TXT`;
  const fetched = await fetchText(url, deps, MAX_HANDLE_DID_BODY_BYTES, { accept: "application/dns-json" });
  if (!fetched.ok) return { state: "none" };

  let answers: DohAnswer[] = [];
  try {
    const parsed = JSON.parse(fetched.body);
    answers = Array.isArray(parsed?.Answer) ? parsed.Answer : [];
  } catch {
    return { state: "none" };
  }

  const dids = new Set<string>();
  for (const answer of answers) {
    if (answer?.type !== 16 || typeof answer.data !== "string") continue;
    const value = parseDohTxtData(answer.data);
    if (!value.startsWith("did=")) continue;
    const did = value.slice("did=".length).trim();
    if (isBlessedDid(did)) dids.add(did);
  }
  if (dids.size === 0) return { state: "none" };
  if (dids.size > 1) return { state: "ambiguous" };
  return { state: "did", did: [...dids][0] };
}

/**
 * Resuelve handle -> DID por los dos metodos del spec (TXT primero,
 * HTTPS well-known como respaldo). HTTPS exige 2xx y body con el DID;
 * whitespace se recorta ("clients should strip small amounts of prefix
 * or suffix whitespace").
 */
export async function resolveHandleToDid(input: unknown, deps: ResolveDeps = {}): Promise<ResolveHandleResult> {
  const parsed = resolvableHandle(input);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason === "reserved_tld" ? "reserved_tld" : "invalid_handle" };
  }
  const handle = parsed.handle;

  const txt = await resolveHandleViaTxt(handle, deps);
  if (txt.state === "ambiguous") return { ok: false, reason: "ambiguous_txt" };
  if (txt.state === "did") return { ok: true, did: txt.did, resolvedBy: "txt" };

  const url = `https://${handle}/.well-known/atproto-did`;
  const fetched = await fetchText(url, deps, MAX_HANDLE_DID_BODY_BYTES, { accept: "text/plain" });
  if (!fetched.ok) {
    if (fetched.tooLarge) return { ok: false, reason: "response_too_large" };
    if (fetched.networkError) return { ok: false, reason: "upstream_error" };
    return { ok: false, reason: "handle_unresolvable" };
  }

  const candidate = fetched.body.trim();
  if (!isBlessedDid(candidate)) {
    // Un body que no es DID soportado: el host contesto pero no publica
    // un DID util. Metodo no-blessed es unsupported; basura es unresolvable.
    const looksLikeDid = typeof candidate === "string" && candidate.startsWith("did:");
    return { ok: false, reason: looksLikeDid ? "unsupported_did_method" : "handle_unresolvable" };
  }
  return { ok: true, did: candidate, resolvedBy: "https" };
}

/**
 * Resuelve DID -> documento. did:plc via plc.directory; did:web
 * hostname-level (AT no soporta paths ni puertos, salvo localhost dev
 * que igual queda fuera por la regla de TLDs reservados).
 */
export async function resolveDidDocument(input: unknown, deps: ResolveDeps = {}): Promise<ResolveDidResult> {
  if (typeof input !== "string" || input.length > MAX_DID_LENGTH || !DID_SYNTAX.test(input)) {
    return { ok: false, reason: "did_syntax_invalid" };
  }
  const parsed = parseAtprotoDid(input);
  if (!parsed.ok) return { ok: false, reason: "did_method_unsupported" };

  let url: string;
  if (parsed.method === "plc") {
    url = `${PLC_DIRECTORY_URL}/${parsed.did}`;
  } else {
    const host = parsed.did.slice("did:web:".length);
    // AT: solo hostname-level. Colon = puerto o path percent-encoded.
    if (host.includes(":") || host.includes("/") || host.includes("%")) {
      return { ok: false, reason: "did_web_unsupported" };
    }
    if (RESERVED_TLDS.has(handleTld(host.toLowerCase())) || !parseHandle(host).ok) {
      return { ok: false, reason: "did_web_unsupported" };
    }
    url = `https://${host.toLowerCase()}/.well-known/did.json`;
  }

  const fetched = await fetchText(url, deps, MAX_DID_DOC_BYTES, { accept: "application/did+json, application/json" });
  if (!fetched.ok) {
    if (fetched.tooLarge) return { ok: false, reason: "response_too_large" };
    if (fetched.networkError) return { ok: false, reason: "did_unreachable" };
    return { ok: false, reason: "did_not_found" };
  }

  let document: AtprotoDidDocument;
  try {
    const parsedDoc = JSON.parse(fetched.body);
    if (!parsedDoc || typeof parsedDoc !== "object" || typeof parsedDoc.id !== "string") {
      return { ok: false, reason: "malformed_document" };
    }
    document = parsedDoc as AtprotoDidDocument;
  } catch {
    return { ok: false, reason: "malformed_document" };
  }
  if (document.id !== input) return { ok: false, reason: "did_mismatch" };
  return { ok: true, document };
}

/**
 * Handles reclamados via `alsoKnownAs` -- "the first syntactically valid
 * handle found in the ordered list is treated as the claimed handle".
 * Devuelve todos los validos (en orden) para poder verificar pertenencia;
 * la validacion bidireccional usa claimedHandles[0] o la igualdad
 * directa contra el handle que estamos resolviendo.
 */
export function claimedHandlesFromDocument(document: AtprotoDidDocument): string[] {
  if (!Array.isArray(document.alsoKnownAs)) return [];
  const handles: string[] = [];
  for (const entry of document.alsoKnownAs) {
    const handle = handleFromAtUri(entry);
    if (handle) handles.push(handle);
  }
  return handles;
}

/**
 * Extrae la clave atproto de firma: `verificationMethod[]` con id que
 * termina en `#atproto` (relativo o calificado), `type: Multikey`,
 * `controller` igual al DID y `publicKeyMultibase` decodificable. Legacy
 * (EcdsaSecp256r1/k1VerificationKey2019) tambien se acepta como id
 * `#atproto`. Primera clave valida gana (spec).
 */
export function extractAtprotoSigningKey(document: AtprotoDidDocument): AtprotoSigningKey | null {
  const methods = Array.isArray(document.verificationMethod) ? document.verificationMethod : [];
  for (const raw of methods) {
    if (!raw || typeof raw !== "object") continue;
    const method = raw as Record<string, unknown>;
    const id = typeof method.id === "string" ? method.id : "";
    const type = typeof method.type === "string" ? method.type : "";
    const multibase = typeof method.publicKeyMultibase === "string" ? method.publicKeyMultibase : "";
    const idMatches = id === "#atproto" || id === `${document.id}#atproto`;
    const typeMatches =
      type === "Multikey" ||
      type === "EcdsaSecp256r1VerificationKey2019" ||
      type === "EcdsaSecp256k1VerificationKey2019";
    if (!idMatches || !typeMatches || !multibase) continue;
    if (decodeMultibaseKey(multibase) === null) continue;
    return { id, type, multibase };
  }
  return null;
}

/** Extrae el endpoint PDS (#atproto_pds, AtprotoPersonalDataServer). */
export function extractPdsEndpoint(document: AtprotoDidDocument): string | null {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const raw of services) {
    if (!raw || typeof raw !== "object") continue;
    const service = raw as Record<string, unknown>;
    const id = typeof service.id === "string" ? service.id : "";
    const type = typeof service.type === "string" ? service.type : "";
    const endpoint = typeof service.serviceEndpoint === "string" ? service.serviceEndpoint : "";
    const idMatches = id === "#atproto_pds" || id === `${document.id}#atproto_pds`;
    if (idMatches && type === "AtprotoPersonalDataServer" && endpoint.startsWith("https://")) {
      return endpoint;
    }
  }
  return null;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Decodifica base58btc (multibase `z...`). Devuelve los bytes crudos;
 * para Multikey moderno el caller valida el multicodec. Devuelve null en
 * cualquier caracter invalido.
 */
export function base58btcDecode(value: string): Uint8Array | null {
  if (value.length === 0) return null;
  let num = 0n;
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) return null;
    num = num * 58n + BigInt(index);
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (let i = 0; i < zeros; i++) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

/**
 * Valida que `multibase` (z + base58btc) decodifica a una clave con
 * multicodec conocido. Multikey moderno lleva multicodec: ed01
 * (ed25519, 32 bytes) o 1201 (p256, 33 bytes comprimido). Legacy no
 * lleva multicodec (bytes crudos) -- se acepta si decodifica no-vacio.
 */
export function decodeMultibaseKey(multibase: string): { codec: "ed25519" | "p256" | "secp256k1" | "raw"; bytes: Uint8Array } | null {
  if (!multibase.startsWith("z")) return null;
  const bytes = base58btcDecode(multibase.slice(1));
  if (bytes === null || bytes.length === 0) return null;
  if (bytes.length >= 3 && bytes[0] === 0xed && bytes[1] === 0x01) {
    return bytes.length === 34 ? { codec: "ed25519", bytes } : null;
  }
  if (bytes.length >= 3 && bytes[0] === 0x12 && bytes[1] === 0x01) {
    return bytes.length === 34 ? { codec: "p256", bytes } : null;
  }
  return { codec: "raw", bytes };
}

/**
 * Resolucion COMPLETA con verificacion bidireccional (spec de handle):
 *   1. handle valido y no reservado;
 *   2. handle -> DID (TXT o HTTPS);
 *   3. DID -> documento (plc.directory / did:web);
 *   4. el documento reclama el handle via alsoKnownAs (`at://<handle>`).
 * Sin el paso 4 el handle NO se confia ("anybody could create handle
 * aliases for third-party accounts").
 */
export async function resolveAtprotoIdentity(input: unknown, deps: ResolveDeps = {}): Promise<ResolveIdentityResult> {
  const parsed = resolvableHandle(input);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason === "reserved_tld" ? "reserved_tld" : "invalid_handle" };
  }
  const handle = parsed.handle;

  const handleResolution = await resolveHandleToDid(handle, deps);
  if (!handleResolution.ok) return handleResolution;

  const didResolution = await resolveDidDocument(handleResolution.did, deps);
  if (!didResolution.ok) return didResolution;

  const document = didResolution.document;
  const claimedHandles = claimedHandlesFromDocument(document);
  if (!claimedHandles.includes(handle)) {
    return { ok: false, reason: "link_mismatch" };
  }

  const method = parseAtprotoDid(handleResolution.did);
  if (!method.ok) return { ok: false, reason: "unsupported_did_method" };

  return {
    ok: true,
    identity: {
      handle,
      did: handleResolution.did,
      didMethod: method.method,
      resolvedBy: handleResolution.resolvedBy,
      document,
      claimedHandles,
      signingKey: extractAtprotoSigningKey(document),
      pds: extractPdsEndpoint(document),
    },
  };
}

/** Solo para tests/introspeccion: el URI que publica un handle en alsoKnownAs. */
export function atUriForHandle(handle: string): string {
  return atUriFromHandle(handle);
}
