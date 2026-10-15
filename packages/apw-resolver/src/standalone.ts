// packages/apw-resolver/src/standalone.ts
//
// Punto de entrada MINIMO para un cliente externo de Protocol APW:
// resolver un did:apw / dominio y verificar su manifest y cadena de
// historia SIN depender del resto del monorepo de Portaless.
//
// Que incluye (y solo esto):
//   - resolveApwManifest / resolveApwIdentity  — DNS TXT -> manifest
//     (seccion 5.1) y did document.
//   - resolveApwHistory + verifyChain          — cadena de historia
//     encadenada por hashes (seccion 5.4).
//   - verifySiteJws / jcs / signSiteJws        — JWS del sitio con JCS
//     RFC 8785 (seccion 5.2).
//   - parseApwDidDocument / buildDidDocument   — documento did:apw
//     (seccion 5.3).
//   - jwkThumbprint / parseDidKeyId            — fingerprint k (RFC
//     7638) y kid (secciones 5.1 y 5.4).
//
// Que NO incluye (viven en otros entry points del paquete y requieren
// stores/DB): scoring de confianza, atestaciones de lectores, witnesses,
// registro de identidad del sitio (eso es el LADO SERVIDOR de Portaless,
// no el lado cliente de un verificador).
//
// Unicas dependencias externas de este grafo: `canonicalize` (JCS) y los
// Web APIs (fetch, crypto.subtle). Nada de Node, nada de better-sqlite3,
// nada de otros paquetes @portaless/*.
//
// Ver docs/protocol-apw/STARTER-KIT.md para la guia orientada a
// implementadores externos y APW-VECTORS-v1.3.md para los vectores de
// aceptacion (conformidad minima: V-01, V-03, V-05, V-06, V-08, V-09).

export { resolveApwManifest, resolveApwIdentity } from "./index";
export type { ApwResolutionResult, ApwIdentityResult } from "./index";
export { resolveApwTxtRecord, APW_TXT_PREFIX } from "./dns-txt/dns-txt";

export { buildDidDocument, parseApwDidDocument } from "./did-apw/document";
export type { ApwDidDocument, ApwVerificationMethod, ApwKeyPair } from "./did-apw/types";

export { resolveApwHistory } from "./did-apw/history-resolver";
export type { ApwHistoryResult, ApwHistoryReason } from "./did-apw/history-resolver";

export { verifyChain, sha256B64Url } from "./did-apw/history-log";
export type { ChainEntry, ChainKey, VerifyChainResult } from "./did-apw/history-log";

export { verifySiteJws, signSiteJws, jcs, MANIFEST_TYP, ATTESTATION_TYP } from "./did-apw/site-jws";
export type { SiteJwsFailure, VerifySiteJwsResult, SiteSigningKey } from "./did-apw/site-jws";

export { jwkThumbprint, publicJwkMembers } from "./did-apw/fingerprint";
export { parseDidKeyId } from "./did-apw/key-id";
export { generateApwDid } from "./did-apw/generate";

export { buildSiteManifest } from "./did-apw/site-manifest";
export type { ApwManifest } from "./manifest";
export { parseApwManifest } from "./manifest";

// ---------------------------------------------------------------------------
// Scoring (LTP Annex A). Exposed because APW-VECTORS v1.3 lists V-08 and V-09
// among the minimal interoperability vectors: without this surface a third party
// could not implement them against the published package at all, since the only
// entry points exported identity, history and manifests. All of these are pure
// and deterministic -- no I/O, no clock, no storage.
// ---------------------------------------------------------------------------

export {
  NEUTRAL,
  PRIOR_WEIGHT,
  SELF_WEIGHT,
  DEVIATION_PENALTY,
  CALIBRATION_ROUNDS,
  issuerWeight,
  judgeFromDeviation,
  toValue,
  readerConductToDimension,
  bayesianScore,
  calibrateJudges,
  scoreSubject,
  scoreOf,
} from "./scoring/scoring";
export type { Source, ScoredAttestation, DimensionScore } from "./scoring/scoring";

export { didKeyId, isDidKeyId } from "./did-apw/key-id";
export type { ParsedDidKeyId } from "./did-apw/key-id";

export { serializeApwManifest, buildApwManifest } from "./manifest";
export type { ApwContentKind, ApwManifestValidationError, ApwManifestValidationResult } from "./manifest";

export { periodKey, READER_CONDUCT_CONFIG } from "./scoring/reader-conduct-config";
export type { EmissionPeriod } from "./scoring/reader-conduct-config";
