import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  base64UrlToBytes,
} from "./rfc9421";

export interface KeyRecord {
  keyId: string;
  operator: string;
  publicKeyJwk?: { kty: string; crv?: string; x?: string; alg?: string };
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
  keyRecord?: KeyRecord;
}

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
const MAX_SIGNATURE_AGE_SECONDS = 300;

interface DirectoryResponse {
  keys: Array<{ kid: string; kty: string; crv?: string; x?: string; alg?: string }>;
}

async function fetchOperatorKeyDirectory(operatorOrigin: string): Promise<DirectoryResponse | null> {
  try {
    const res = await fetch(new URL(DIRECTORY_PATH, operatorOrigin).toString(), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as DirectoryResponse;
  } catch {
    return null;
  }
}

export async function verifyWebBotAuthRequest(request: Request): Promise<VerifyResult> {
  const signatureAgent = request.headers.get("Signature-Agent");
  if (!signatureAgent) return { verified: false, reason: "missing_signature_agent_header" };

  const signatureInputHeader = request.headers.get("Signature-Input");
  const signatureHeader = request.headers.get("Signature");
  if (!signatureInputHeader || !signatureHeader) {
    return { verified: false, reason: "missing_signature_headers" };
  }

  const parsed = parseSignatureInput(signatureInputHeader);
  if (!parsed) return { verified: false, reason: "malformed_signature_input" };
  if (parsed.algorithm !== "ed25519") return { verified: false, reason: `unsupported_algorithm:${parsed.algorithm}` };

  if (parsed.expires) {
    const now = Math.floor(Date.now() / 1000);
    if (now > parsed.expires) return { verified: false, reason: "signature_expired" };
  }
  if (parsed.created) {
    const now = Math.floor(Date.now() / 1000);
    if (now - parsed.created > MAX_SIGNATURE_AGE_SECONDS) return { verified: false, reason: "signature_too_old" };
  }

  let operatorOrigin: string;
  try {
    operatorOrigin = new URL(signatureAgent).origin;
  } catch {
    return { verified: false, reason: "invalid_signature_agent_url" };
  }

  const directory = await fetchOperatorKeyDirectory(operatorOrigin);
  if (!directory) return { verified: false, reason: "key_directory_unreachable" };

  const keyEntry = directory.keys.find((k) => k.kid === parsed.keyId);
  if (!keyEntry) return { verified: false, reason: "keyid_not_in_directory" };
  if (keyEntry.kty !== "OKP" || keyEntry.crv !== "Ed25519" || !keyEntry.x) {
    return { verified: false, reason: "unsupported_key_type_in_directory" };
  }

  const signatureBytes = parseSignatureHeader(signatureHeader, parsed.label);
  if (!signatureBytes) return { verified: false, reason: "malformed_signature_header" };

  const signatureBase = buildSignatureBase(request, parsed);
  const publicKeyRaw = base64UrlToBytes(keyEntry.x);

  const cryptoOk = await verifyEd25519Signature(signatureBase, signatureBytes, publicKeyRaw);
  if (!cryptoOk) return { verified: false, reason: "signature_verification_failed" };

  return { verified: true, keyRecord: { keyId: parsed.keyId, operator: operatorOrigin, publicKeyJwk: keyEntry } };
}
