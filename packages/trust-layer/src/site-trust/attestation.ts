// Compatibility re-export: APW attestation verification lives in L1 (apw-resolver).
export {
  ATTESTATION_TYP,
  ATTESTATION_IAT_WINDOW_SECONDS,
  sameIssuer,
  verifyAttestation,
} from "@portaless/apw-resolver/did-apw";
export type {
  AttestationSource,
  AttestationVal,
  AttestationClaims,
  AttestationFailure,
  AttestationExpectations,
  VerifyAttestationResult,
} from "@portaless/apw-resolver/did-apw";
