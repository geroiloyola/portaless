// packages/apw-resolver/src/manifest-with-identity.ts
//
// Extension ADITIVA de manifest.ts para incluir el didDocument (identidad
// did:apw, ver src/did-apw/) en el payload publicado via TXT record.
//
// Deliberadamente NO modifica manifest.ts ni sus tipos internos -- compone
// el resultado de buildApwManifest() con un campo didDocument opcional por
// fuera, para no arriesgar romper el contrato ya cubierto por
// tests/unit/apw-manifest.test.ts (13 tests) sobre un archivo que no se
// modifico en esta sesion.

import type { ApwDidDocument } from "./did-apw/types";

export function buildApwManifestWithIdentity<T extends Record<string, unknown>>(
  baseManifest: T,
  didDocument: ApwDidDocument
): T & { didDocument: ApwDidDocument } {
  return { ...baseManifest, didDocument };
}

export function extractDidDocumentFromManifest(manifest: unknown): ApwDidDocument | null {
  if (!manifest || typeof manifest !== "object") return null;
  const candidate = (manifest as Record<string, unknown>).didDocument;
  if (!candidate) return null;
  return candidate as ApwDidDocument;
}
