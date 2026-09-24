// Definicion del payload que cada sitio publica en su registro DNS TXT
// bajo `_apw.<dominio>` (protocolo APW). Ver docs/protocol-apw/APW-SPEC-v1.0.md
// seccion 7 y ROADMAP.md, "Portaless Public: descubrimiento y confianza
// entre sitios".
//
// El payload se serializa como JSON compacto (sin espacios) para
// aprovechar al maximo el limite practico de ~512 bytes por TXT record sin
// forzar TCP. Campos opcionales se omiten en vez de serializarse como
// `null` para ahorrar bytes.

export const APW_MANIFEST_VERSION = 1 as const;

/**
 * Resumen de tipos de contenido que un sitio declara publicar. Mismo
 * concepto que `contentKinds` en `SiteInfo`
 * (docs/architecture/creator-sites-agentic-workflow.md) -- se reutiliza el
 * campo existente en vez de inventar un vocabulario nuevo para el manifiesto.
 */
export type ApwContentKind = "text" | "image" | "product" | "link" | "mixed";

export interface ApwManifest {
  /** Version del formato del payload -- permite evolucionar sin romper resolvers viejos. */
  v: typeof APW_MANIFEST_VERSION;
  /** Identificador del sitio, mismo valor usado como `:siteId` en `/trust/:siteId`. */
  siteId: string;
  /** Ruta relativa al SiteTrustScore publico de este sitio. Siempre `/trust/<siteId>`. */
  trustUrl: string;
  /** Resumen de que tipo de contenido publica este sitio. Al menos un valor. */
  contentKinds: ApwContentKind[];
}

export type ApwManifestValidationError =
  | "not_an_object"
  | "missing_or_invalid_version"
  | "missing_or_invalid_siteId"
  | "missing_or_invalid_trustUrl"
  | "missing_or_invalid_contentKinds"
  | "empty_contentKinds"
  | "invalid_contentKind_value";

export interface ApwManifestValidationResult {
  valid: boolean;
  error?: ApwManifestValidationError;
  manifest?: ApwManifest;
}

const VALID_CONTENT_KINDS: readonly ApwContentKind[] = ["text", "image", "product", "link", "mixed"];

/** Construye el manifiesto y lo serializa como JSON compacto listo para publicar en un TXT record. */
export function buildApwManifest(input: {
  siteId: string;
  contentKinds: ApwContentKind[];
}): ApwManifest {
  return {
    v: APW_MANIFEST_VERSION,
    siteId: input.siteId,
    trustUrl: `/trust/${input.siteId}`,
    contentKinds: input.contentKinds,
  };
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

  if (obj.v !== APW_MANIFEST_VERSION) {
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

  return {
    valid: true,
    manifest: {
      v: APW_MANIFEST_VERSION,
      siteId: obj.siteId,
      trustUrl: obj.trustUrl,
      contentKinds: obj.contentKinds as ApwContentKind[],
    },
  };
}
