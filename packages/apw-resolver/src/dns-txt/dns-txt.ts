// Cliente real de resolucion DNS-over-HTTPS para Protocol APW.
//
// Lee registros TXT bajo el prefijo `_apw.<dominio>` para descubrir el
// manifiesto APW de un sitio (siteId, referencia a SiteTrustScore,
// contentKinds). Usa DNS-over-HTTPS (Cloudflare 1.1.1.1) en vez del modulo
// nativo `dns` de Node porque este resolver corre en el mismo runtime edge
// (Cloudflare Pages Functions) que ya usa `packages/trust-layer/src/webbotauth/`
// -- ese runtime no tiene sockets UDP/TCP nativos disponibles.
//
// Limite real de un registro TXT DNS: 255 bytes por string individual,
// ~512 bytes practicos por respuesta sin forzar TCP (ya documentado en
// docs/protocol-apw/apw-spec.md). Un resolver DoH puede devolver un TXT
// fragmentado en multiples strings dentro del mismo record -- este modulo
// los concatena en el orden que los devuelve el resolver, coherente con
// RFC 7469 / practica estandar de lectura de TXT multi-string.

export const APW_TXT_PREFIX = "_apw";

export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

export type DnsTxtLookupReason =
  | "ok"
  | "invalid_domain"
  | "doh_request_failed"
  | "doh_response_not_ok"
  | "no_txt_records"
  | "malformed_dns_response";

export interface DnsTxtRecord {
  /** Contenido completo del TXT record, con los strings fragmentados ya concatenados. */
  value: string;
}

export interface DnsTxtLookupResult {
  resolved: boolean;
  reason: DnsTxtLookupReason;
  records: DnsTxtRecord[];
  /** Dominio exacto consultado (`_apw.<dominio>`), util para logging/debug. */
  queriedName?: string;
}

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const TXT_RECORD_TYPE = 16;

// Dominio valido minimo: al menos un punto, sin espacios, sin protocolo.
// Deliberadamente permisivo (no intenta validar contra la spec completa de
// RFC 1035) -- el objetivo es rechazar entradas obviamente invalidas antes
// de gastar una request de red, no ser el validador canonico de dominios.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain.trim());
}

/**
 * Decodifica el campo `data` de una respuesta DoH para TXT records.
 *
 * Cloudflare 1.1.1.1 devuelve el TXT ya como string entre comillas dobles,
 * con cada fragmento del record separado por `" "` cuando el TXT original
 * tenia multiples strings (ej: `"parte1" "parte2"`). Este parser concatena
 * todos los fragmentos en orden.
 */
export function parseDohTxtData(raw: string): string {
  const matches = raw.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!matches) return raw;
  return matches
    .map((segment) => segment.slice(1, -1).replace(/\\"/g, "\""))
    .join("");
}

/**
 * Resuelve los registros TXT publicados bajo `_apw.<domain>` via
 * DNS-over-HTTPS.
 *
 * No lanza excepciones para fallos esperables de red/DNS -- los reporta
 * como `{ resolved: false, reason }`, mismo principio que
 * `verifyWebBotAuthRequest()` en el modulo de Web Bot Auth (un resultado
 * estructurado es mas facil de loguear/auditar que un catch generico).
 */
export async function resolveApwTxtRecord(
  domain: string,
  fetchImpl: typeof fetch = fetch
): Promise<DnsTxtLookupResult> {
  const trimmed = domain.trim().toLowerCase();
  if (!isValidDomain(trimmed)) {
    return { resolved: false, reason: "invalid_domain", records: [] };
  }

  const queriedName = `${APW_TXT_PREFIX}.${trimmed}`;
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(queriedName)}&type=TXT`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/dns-json" } });
  } catch {
    return { resolved: false, reason: "doh_request_failed", records: [], queriedName };
  }

  if (!response.ok) {
    return { resolved: false, reason: "doh_response_not_ok", records: [], queriedName };
  }

  let parsed: DohResponse;
  try {
    parsed = (await response.json()) as DohResponse;
  } catch {
    return { resolved: false, reason: "malformed_dns_response", records: [], queriedName };
  }

  if (typeof parsed.Status !== "number" || !Array.isArray(parsed.Answer)) {
    return { resolved: false, reason: "malformed_dns_response", records: [], queriedName };
  }

  const txtAnswers = parsed.Answer.filter((a) => a.type === TXT_RECORD_TYPE && typeof a.data === "string");
  if (txtAnswers.length === 0) {
    return { resolved: false, reason: "no_txt_records", records: [], queriedName };
  }

  const records: DnsTxtRecord[] = txtAnswers.map((a) => ({ value: parseDohTxtData(a.data) }));
  return { resolved: true, reason: "ok", records, queriedName };
}
