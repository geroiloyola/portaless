// Resolver de alto nivel de Protocol APW: combina la lectura DNS-TXT
// (dns-txt.ts) con el parseo/validacion del manifiesto (manifest.ts) para
// dar una unica funcion de entrada: "dado un dominio, dime si publica un
// manifiesto APW valido, y cual es".
//
// Este es el punto de entrada que usara Portaless Index (pendiente, ver
// ROADMAP.md) y cualquier agente externo que quiera verificar la identidad
// APW de un sitio sin conocer los detalles de DNS-over-HTTPS.

import { resolveApwTxtRecord, type DnsTxtLookupReason } from "./dns-txt/dns-txt";
import { parseApwManifest, type ApwManifest, type ApwManifestValidationError } from "./manifest";

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

export { resolveApwTxtRecord, APW_TXT_PREFIX, DOH_ENDPOINT } from "./dns-txt/dns-txt";
export { buildApwManifest, serializeApwManifest, parseApwManifest, APW_MANIFEST_VERSION } from "./manifest";
export type { ApwManifest, ApwContentKind } from "./manifest";
