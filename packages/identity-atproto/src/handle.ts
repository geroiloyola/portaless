// packages/identity-atproto/src/handle.ts
//
// Sintaxis y normalizacion de handles AT Protocol, verbatim del spec
// https://atproto.com/specs/handle ("Handle Identifier Syntax"):
//
//  - solo ASCII, maximo 253 caracteres;
//  - segmentos ("labels") separados por punto, sin punto inicial ni final,
//    y al menos DOS segmentos (un TLD "desnudo" no es handle valido);
//  - cada segmento: 1-63 caracteres de [a-z0-9-], sin guion al inicio ni
//    al final;
//  - el ultimo segmento (TLD) no puede empezar con digito;
//  - case-insensitive: se normaliza a minusculas antes de validar.
//
// La referencia del spec da la regex con mayusculas permitidas porque
// valida antes de normalizar; aca primero se normaliza y se valida con la
// version en minusculas -- misma regla, mismo efecto.
//
// Nota de parsing: un handle NUNCA lleva "@" en backend ("@user.example"
// es solo formato de UI -- "not a valid syntax for a handle in records,
// APIs, y otros contextos back-end"). normalizeHandle() acepta el "@"
// porque viene de UI/URL, y lo descarta.
//
// Los TLDs reservados (spec "Additional Non-Syntax Restrictions") NO
// fallan la validacion sintactica -- fallan la RESOLUCION. Por eso viven
// en una funcion aparte (resolvableHandle) y no dentro de isValidHandle.

/** Sintaxis del spec, en minusculas (ya normalizado). */
const HANDLE_SYNTAX =
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const MAX_HANDLE_LENGTH = 253;

/**
 * TLDs que "must immediately fail any attempt at registration, resolution,
 * etc." (spec). `.test` va incluido: el spec lo deja para desarrollo, pero
 * "should fail in real-world environments" -- este endpoint ES production.
 */
export const RESERVED_TLDS: ReadonlySet<string> = new Set([
  "alt",
  "arpa",
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);

export type HandleParseReason = "empty" | "invalid_syntax" | "too_long" | "reserved_tld";

export type HandleParseResult =
  | { ok: true; handle: string }
  | { ok: false; reason: HandleParseReason };

/** Minusculas + trim + descarta el "@" de UI. null si no es string utilizable. */
function canonicalize(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (value.startsWith("@")) value = value.slice(1);
  value = value.trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/** Valida sintaxis pura (spec), sin mirar TLDs reservados. */
export function isValidHandleSyntax(handle: string): boolean {
  return handle.length <= MAX_HANDLE_LENGTH && HANDLE_SYNTAX.test(handle);
}

/**
 * Parsea entrada arbitraria (UI, path de URL, JSON) como handle.
 * NO rechaza TLDs reservados: "Reserved TLDs should not fail syntax
 * validation" -- para eso esta resolvableHandle().
 */
export function parseHandle(input: unknown): HandleParseResult {
  const canonical = canonicalize(input);
  if (canonical === null) return { ok: false, reason: "empty" };
  if (canonical.length > MAX_HANDLE_LENGTH) return { ok: false, reason: "too_long" };
  if (!HANDLE_SYNTAX.test(canonical)) return { ok: false, reason: "invalid_syntax" };
  return { ok: true, handle: canonical };
}

/** TLD (ultimo segmento) de un handle ya parseado. */
export function handleTld(handle: string): string {
  const dot = handle.lastIndexOf(".");
  return dot === -1 ? "" : handle.slice(dot + 1);
}

/**
 * Parseo + restriccion de resolucion: syntax valida Y TLD no reservado.
 * Es lo que usan los resolvedores y el endpoint publico antes de gastar
 * una request de red.
 */
export function resolvableHandle(input: unknown): HandleParseResult {
  const parsed = parseHandle(input);
  if (!parsed.ok) return parsed;
  if (RESERVED_TLDS.has(handleTld(parsed.handle))) {
    return { ok: false, reason: "reserved_tld" };
  }
  return parsed;
}

/** `at://user.example.com` -- la forma que vive en `alsoKnownAs`. */
export function atUriFromHandle(handle: string): string {
  return `at://${handle}`;
}

/**
 * Extrae el handle de un URI `at://[@]handle`. Rechaza cualquier otra
 * forma (path, query, fragment, algo que no sea at://) -- el spec de DID
 * dice "at:// + handle hostname, sin otras partes ni trailing chars".
 */
export function handleFromAtUri(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith("at://")) return null;
  let rest = uri.slice("at://".length);
  if (rest.startsWith("@")) rest = rest.slice(1);
  if (rest.includes("/") || rest.includes("?") || rest.includes("#") || rest.includes(":")) return null;
  return isValidHandleSyntax(rest.toLowerCase()) ? rest.toLowerCase() : null;
}

/**
 * Sufijos de dominio candidatos a identidad APW para un handle, del mas
 * especifico al menos: `username.wikipedia.org` ->
 * ["username.wikipedia.org", "wikipedia.org"]. El TLD desnudo ("org")
 * queda fuera (un sitio APW con siteId de un solo segmento no existe en
 * la practica y `did:apw:org` no seria un dominio servible).
 */
export function apwCandidateDomains(handle: string): string[] {
  const parts = handle.split(".");
  const candidates: string[] = [];
  for (let i = 0; i <= parts.length - 2; i++) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}
