// Definicion del payload que cada sitio publica en su registro DNS TXT
// bajo `_apw.<dominio>` (protocolo APW). Ver docs/protocol-apw/APW-SPEC-v1.2.md
// seccion 5.1 y docs/protocol-apw/ERRATA.md.
//
// El payload se serializa como JSON compacto (sin espacios) para
// aprovechar al maximo el limite practico de ~512 bytes por TXT record sin
// forzar TCP. Campos opcionales se omiten en vez de serializarse como
// `null` para ahorrar bytes.
//
// APW v1.2: version 2 del manifiesto, con campos opcionales
//   k  -> huella RFC 7638 de la clave publica activa del sitio (43 chars)
//   h  -> cabeza del historial encadenado (43 chars, seccion 5.4)
//   rg -> lectura gobernada (seccion 6.5)
// buildApwManifest() sigue generando v1 si no recibe ninguno de esos
// campos, y parseApwManifest() acepta v1 y v2.

export const APW_MANIFEST_VERSION = 1 as const;
export const APW_MANIFEST_VERSION_V2 = 2 as const;

/**
 * Resumen de tipos de contenido que un sitio declara publicar. Mismo
 * concepto que `contentKinds` en `SiteInfo`
 * (docs/architecture/creator-sites-agentic-workflow.md) -- se reutiliza el
 * campo existente en vez de inventar un vocabulario nuevo para el manifiesto.
 */
export type ApwContentKind = "text" | "image" | "product" | "link" | "mixed";

export interface ApwManifest {
  /** Version del formato del payload -- permite evolucionar sin romper resolvers viejos. */
  v: typeof APW_MANIFEST_VERSION | typeof APW_MANIFEST_VERSION_V2;
  /** Identificador del sitio, mismo valor usado como `:siteId` en `/trust/:siteId`. */
  siteId: string;
  /** Ruta relativa al SiteTrustScore publico de este sitio. Siempre `/trust/<siteId>`. */
  trustUrl: string;
  /** Resumen de que tipo de contenido publica este sitio. Al menos un valor. */
  contentKinds: ApwContentKind[];
  /** v2: huella RFC 7638 de la clave publica activa. */
  k?: string;
  /** v2: cabeza del historial encadenado. */
  h?: string;
  /** v2: el sitio gobierna la lectura de sus datos de confianza. */
  rg?: boolean;
}

export type ApwManifestValidationError =
  | "not_an_object"
  | "missing_or_invalid_version"
  | "missing_or_invalid_siteId"
  | "missing_or_invalid_trustUrl"
  | "missing_or_invalid_contentKinds"
  | "empty_contentKinds"
  | "invalid_contentKind_value"
  | "invalid_key_fingerprint"
  | "invalid_history_head"
  | "invalid_read_governance";

export interface ApwManifestValidationResult {
  valid: boolean;
  error?: ApwManifestValidationError;
  manifest?: ApwManifest;
}

const VALID_CONTENT_KINDS: readonly ApwContentKind[] = ["text", "image", "product", "link", "mixed"];
const HASH_43_RE = /^[A-Za-z0-9_-]{43}$/;

/** Construye el manifiesto. Con k, h o rg genera v2; sin ellos, v1 como antes. */
export function buildApwManifest(input: {
  siteId: string;
  contentKinds: ApwContentKind[];
  k?: string;
  h?: string;
  rg?: boolean;
}): ApwManifest {
  const isV2 = input.k !== undefined || input.h !== undefined || input.rg !== undefined;
  const manifest: ApwManifest = {
    v: isV2 ? APW_MANIFEST_VERSION_V2 : APW_MANIFEST_VERSION,
    siteId: input.siteId,
    trustUrl: `/trust/${input.siteId}`,
    contentKinds: input.contentKinds,
  };
  if (input.k !== undefined) manifest.k = input.k;
  if (input.h !== undefined) manifest.h = input.h;
  if (input.rg !== undefined) manifest.rg = input.rg;
  return manifest;
}

/** Serializa un manifiesto ya construido a JSON compacto (sin espacios). */
export function serializeApwManifest(manifest: ApwManifest): string {
  return JSON.stringify(manifest);
}

/**
 * Parsea y valida el contenido de un TXT record como manifiesto APW.
 *
 * No lanza excepciones -- un TXT record con contenido ajeno al protocolo
 * APW (o corrupto) es un caso esperado, no un error de programa. El
 * resolver de mas alto nivel decide que hacer con `valid: false`.
 */
export function parseApwManifest(raw: string): ApwManifestValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { valid: false, error: "not_an_object" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, error: "not_an_object" };
  }

  const obj = data as Record<string, unknown>;

  if (obj.v !== APW_MANIFEST_VERSION && obj.v !== APW_MANIFEST_VERSION_V2) {
    return { valid: false, error: "missing_or_invalid_version" };
  }

  if (typeof obj.siteId !== "string" || obj.siteId.trim().length === 0) {
    return { valid: false, error: "missing_or_invalid_siteId" };
  }

  if (typeof obj.trustUrl !== "string" || !obj.trustUrl.startsWith("/trust/")) {
    return { valid: false, error: "missing_or_invalid_trustUrl" };
  }

  if (!Array.isArray(obj.contentKinds)) {
    return { valid: false, error: "missing_or_invalid_contentKinds" };
  }

  if (obj.contentKinds.length === 0) {
    return { valid: false, error: "empty_contentKinds" };
  }

  for (const kind of obj.contentKinds) {
    if (typeof kind !== "string" || !VALID_CONTENT_KINDS.includes(kind as ApwContentKind)) {
      return { valid: false, error: "invalid_contentKind_value" };
    }
  }

  const manifest: ApwManifest = {
    v: obj.v as ApwManifest["v"],
    siteId: obj.siteId,
    trustUrl: obj.trustUrl,
    contentKinds: obj.contentKinds as ApwContentKind[],
  };

  // Los campos de v2 solo cuentan en un manifiesto v2; en v1 se ignoran.
  if (obj.v === APW_MANIFEST_VERSION_V2) {
    if (obj.k !== undefined) {
      if (typeof obj.k !== "string" || !HASH_43_RE.test(obj.k)) return { valid: false, error: "invalid_key_fingerprint" };
      manifest.k = obj.k;
    }
    if (obj.h !== undefined) {
      if (typeof obj.h !== "string" || !HASH_43_RE.test(obj.h)) return { valid: false, error: "invalid_history_head" };
      manifest.h = obj.h;
    }
    if (obj.rg !== undefined) {
      if (typeof obj.rg !== "boolean") return { valid: false, error: "invalid_read_governance" };
      manifest.rg = obj.rg;
    }
  }

  return { valid: true, manifest };
}
