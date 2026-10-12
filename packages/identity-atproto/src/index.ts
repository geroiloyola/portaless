// @portaless/identity-atproto -- identidad AT Protocol + puente opcional
// con APW. Ver docs/architecture/identity-atproto.md.

export {
  parseHandle,
  resolvableHandle,
  isValidHandleSyntax,
  handleTld,
  atUriFromHandle,
  handleFromAtUri,
  apwCandidateDomains,
  RESERVED_TLDS,
  MAX_HANDLE_LENGTH,
  type HandleParseReason,
  type HandleParseResult,
} from "./handle";

export {
  resolveHandleToDid,
  resolveDidDocument,
  resolveAtprotoIdentity,
  parseAtprotoDid,
  claimedHandlesFromDocument,
  extractAtprotoSigningKey,
  extractPdsEndpoint,
  base58btcDecode,
  decodeMultibaseKey,
  parseDohTxtData,
  PLC_DIRECTORY_URL,
  DOH_ENDPOINT,
  BLESSSED_DID_METHODS,
  type AtprotoDidDocument,
  type AtprotoSigningKey,
  type ResolvedAtprotoIdentity,
  type ResolveDeps,
  type ResolveHandleResult,
  type ResolveDidResult,
  type ResolveIdentityResult,
  type HandleResolutionReason,
  type DidResolutionReason,
  type IdentityReason,
} from "./resolve";

export {
  linkConfidence,
  findApwLink,
  apwClaimedHandles,
  candidateDomainsForHandle,
  apwAtUri,
  type ApwLink,
  type ApwLinkConfidence,
} from "./link";

export {
  buildAtprotoReputation,
  __clearAtprotoReputationCacheForTests,
  type AtprotoReputationResult,
  type AtprotoReputationDeps,
  type AtprotoUserReputation,
  type SiteTrustView,
} from "./reputation";
