// Compatibility re-export: APW attestation verification lives in L1 (apw-resolver).
export {
  ATTESTATION_TYP,
  ATTESTATION_IAT_WINDOW_SECONDS,
  sameIssuer,
  verifyAttestation,
} from "../../../apw-resolver/src/did-apw/attestation";
export type {
  AttestationSource,
  AttestationVal,
  AttestationClaims,
  AttestationFailure,
  AttestationExpectations,
  VerifyAttestationResult,
} from "../../../apw-resolver/src/did-apw/attestation";
