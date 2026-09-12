// Verificacion de HTTP Message Signatures (Web Bot Auth) sobre una Request
// entrante. Implementacion minima de referencia: valida presencia y forma de
// los headers, resuelve la clave del operador, y expone un resultado
// estructurado. Para produccion real, sustituir la verificacion criptografica
// interna por una libreria auditada de HTTP Message Signatures (RFC 9421).

import { resolveAgentKeyDirectory, type AgentKeyRecord } from "./key-directory";

export interface VerificationResult {
  verified: boolean;
  reason: string;
  keyRecord?: AgentKeyRecord;
  operatorDomain?: string;
}

function parseSignatureAgentHeader(value: string | null): string | null {
  if (!value) return null;
  // El header "Signature-Agent" declara el dominio del operador, ej:
  // Signature-Agent: "example-ai-operator.com"
  return value.replace(/^"|"$/g, "").trim() || null;
}

/**
 * Verifica una peticion HTTP entrante segun Web Bot Auth.
 *
 * NOTA IMPORTANTE: la verificacion criptografica real de la firma (RFC 9421)
 * requiere reconstruir la base de firma exacta (metodo, path, headers
 * cubiertos) y validarla contra la clave publica con la libreria adecuada
 * para el algoritmo declarado. Este archivo deja ese paso marcado
 * explicitamente como TODO para no dar una falsa sensacion de seguridad
 * verificada con una implementacion de placeholder.
 */
export async function verifyWebBotAuthRequest(
  request: Request
): Promise<VerificationResult> {
  const signatureInput = request.headers.get("Signature-Input");
  const signature = request.headers.get("Signature");
  const signatureAgent = parseSignatureAgentHeader(
    request.headers.get("Signature-Agent")
  );

  if (!signatureInput || !signature || !signatureAgent) {
    return {
      verified: false,
      reason: "missing_signature_headers",
    };
  }

  let keys: AgentKeyRecord[];
  try {
    keys = await resolveAgentKeyDirectory(signatureAgent);
  } catch (err) {
    return {
      verified: false,
      reason: `key_directory_unreachable: ${(err as Error).message}`,
      operatorDomain: signatureAgent,
    };
  }

  // TODO(seguridad): reconstruir la base de firma segun RFC 9421 y verificar
  // criptograficamente contra la clave correspondiente en `keys`, usando el
  // algoritmo declarado en cada AgentKeyRecord. Ver docs/TRUST_LAYER_SETUP.md.
  const matchedKey = keys[0];

  if (!matchedKey) {
    return {
      verified: false,
      reason: "no_matching_key",
      operatorDomain: signatureAgent,
    };
  }

  return {
    verified: true,
    reason: "signature_present_key_resolved_crypto_check_pending",
    keyRecord: matchedKey,
    operatorDomain: signatureAgent,
  };
}
