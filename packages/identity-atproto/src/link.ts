// packages/identity-atproto/src/link.ts
//
// Puente OPCIONAL APW <-> AT Protocol: dado un handle AT resuelto,
// determinar que identidad APW (did:apw:<siteId>) se asocia y con que
// nivel de confianza. Tres mecanismos, en orden de fuerza:
//
//   1. "also_known_as" -- el documento did:apw del sitio publica
//      `alsoKnownAs: ["at://<handle>"]` (claim explicito del sitio, el
//      mismo campo W3C que AT Proto ya lee en sus propios DID docs).
//   2. "self" -- el handle ES el dominio del sitio APW
//      (`@example.com` sobre `did:apw:example.com`).
//   3. "subdomain" -- el handle vive bajo el dominio del sitio
//      (`@username.example.com` sobre `did:apw:example.com`): la
//      jerarquia DNS demuestra control del dominio, asi que la
//      reputacion del sitio se extiende a su subdominio.
//
// Todo es opcional: un sitio sin APW resuelve igual (solo identity AT),
// y un sitio APW sin ningun vinculo AT no cambia en nada su comportamiento.
// La direccion inversa (encontrar QUE sitio reclama un handle de
// otro dominio) requiere un indice inverso -- Portaless Index, futuro
// trabajo; documentado como limite honesto en identity-atproto.md.

import { apwCandidateDomains, handleFromAtUri, atUriFromHandle } from "./handle";
import type { AtprotoDidDocument } from "./resolve";

export type ApwLinkConfidence = "also_known_as" | "self" | "subdomain";

export interface ApwLink {
  siteId: string;
  confidence: ApwLinkConfidence;
}

/** Handles AT que el documento APW reclama via alsoKnownAs. */
export function apwClaimedHandles(document: unknown): string[] {
  const doc = document as { alsoKnownAs?: unknown } | null | undefined;
  if (!doc || !Array.isArray(doc.alsoKnownAs)) return [];
  const handles: string[] = [];
  for (const entry of doc.alsoKnownAs) {
    const handle = handleFromAtUri(entry);
    if (handle) handles.push(handle);
  }
  return handles;
}

/**
 * Confianza del vinculo entre un handle y un sitio APW candidato.
 * null = el sitio no tiene relacion alguna con el handle.
 */
export function linkConfidence(
  handle: string,
  siteId: string,
  apwDidDocument?: { alsoKnownAs?: unknown } | null
): ApwLinkConfidence | null {
  if (apwDidDocument && apwClaimedHandles(apwDidDocument).includes(handle)) {
    return "also_known_as";
  }
  if (handle === siteId) return "self";
  if (handle.endsWith(`.${siteId}`)) return "subdomain";
  return null;
}

const CONFIDENCE_RANK: Record<ApwLinkConfidence, number> = {
  also_known_as: 3,
  self: 2,
  subdomain: 1,
};

/**
 * Mejor vinculo entre un handle y una lista de sitios APW candidatos ya
 * resueltos (el caller trae la resolucion -- aca no hay red). Devuelve el
 * de mayor confianza; empates -> el dominio mas especifico (orden de la
 * lista, que va de largo a corto).
 */
export function findApwLink(
  handle: string,
  candidates: Array<{ siteId: string; didDocument?: { alsoKnownAs?: unknown } | null }>
): ApwLink | null {
  let best: ApwLink | null = null;
  for (const candidate of candidates) {
    const confidence = linkConfidence(handle, candidate.siteId, candidate.didDocument);
    if (!confidence) continue;
    if (!best || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = { siteId: candidate.siteId, confidence };
    }
  }
  return best;
}

/** Los candidatos APW para un handle (de dominio completo a raiz). */
export function candidateDomainsForHandle(handle: string): string[] {
  return apwCandidateDomains(handle);
}

/** `at://<handle>` -- forma publicable en un did doc. */
export function apwAtUri(handle: string): string {
  return atUriFromHandle(handle);
}

/** Tipo minimo del documento DID APW que nos interesa para el vinculo. */
export type LinkableDidDocument = Pick<AtprotoDidDocument, "id"> & { alsoKnownAs?: unknown };
