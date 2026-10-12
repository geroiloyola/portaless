// @portaless/cloud-images -- Cloud Images + APW como SSOT criptografico.
// Ver docs/architecture/cloud-images.md.

export {
  DECLARED_ORIGINS,
  MAX_IMAGE_BYTES,
  ALLOWED_CONTENT_TYPES,
  CONTENT_HASH_RE,
  sha256Hash,
  isContentHash,
  isAllowedContentType,
  isDeclaredOrigin,
  buildCloudImagePayload,
  validatePayload,
  parseSidecar,
  decodeBase64,
  encodeBase64,
  type DeclaredOrigin,
  type ImageTrust,
  type ImageProjection,
  type CloudImagePayload,
  type CloudImageSidecar,
  type BuildPayloadInput,
} from "./payload";

export {
  IMAGE_TYP,
  signCloudImage,
  decodeJwsHeader,
  verifyCloudImageSidecar,
  imageKidBelongsToDid,
  type DecodedJwsHeader,
  type VerificationKey,
  type CloudImageVerifyFailure,
  type CloudImageVerifyResult,
} from "./sign";

export {
  PNG_SIGNATURE,
  APW_CHUNK_TYPE,
  crc32,
  isPng,
  embedPng,
  extractPng,
  stripPng,
  type PngEmbedFailure,
} from "./png";

export {
  CLOUD_IMAGES_TABLE_DDL,
  CLOUD_IMAGES_HASH_INDEX_DDL,
  createCloudImageStore,
  D1CloudImageStore,
  SqliteCloudImageStore,
  InMemoryCloudImageStore,
  type CloudImageRecord,
  type CloudImagePutInput,
  type CloudImageStore,
} from "./store";

export {
  IMAGE_SITE_ID,
  captureSiteTrust,
  type CaptureTrustDeps,
  type TrustStoreLike,
  type SiteTrustSnapshotLike,
} from "./trust";

export {
  verifySidecarRemote,
  type RemoteVerifyDeps,
  type RemoteVerifyResult,
  type ContentHashStatus,
} from "./verify-remote";
