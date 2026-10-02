// packages/apw-resolver/src/did-apw/site-manifest.ts
//
// Campos del manifiesto APW de ESTE sitio. Fuente unica para:
//   - el TXT sugerido (functions/admin/api/apw-verification-status.js)
//   - el manifiesto firmado (functions/.well-known/apw-manifest.jws.js, 5.2)
// Si los dos armaran el manifiesto por separado podrian divergir, y un
// resolver veria un .jws que no coincide con el DNS.
//
// siteId = dominio servido y contentKinds = ["mixed"], igual que el TXT desde
// v0.0.9.30. k solo si hay identidad; h solo junto con k (B6).

import { buildApwManifest, type ApwManifest } from "../manifest";

export function buildSiteManifest(domain: string, k?: string | null, h?: string | null): ApwManifest {
  return buildApwManifest({
    siteId: domain,
    contentKinds: ["mixed"],
    ...(k ? { k } : {}),
    ...(k && h ? { h } : {}),
  });
}
