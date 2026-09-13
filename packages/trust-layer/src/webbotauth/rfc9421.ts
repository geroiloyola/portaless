export interface ParsedSignatureInput {
  label: string;
  coveredComponents: string[];
  keyId: string;
  algorithm: string;
  created?: number;
  expires?: number;
  nonce?: string;
}

export function parseSignatureInput(headerValue: string): ParsedSignatureInput | null {
  const match = headerValue.match(/^([a-zA-Z0-9_-]+)=\(([^)]*)\)(.*)$/);
  if (!match) return null;

  const [, label, componentsRaw, paramsRaw] = match;
  const coveredComponents = componentsRaw
    .split(" ")
    .map((c) => c.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  const params: Record<string, string> = {};
  const paramRegex = /;\s*([a-zA-Z0-9_-]+)=("([^"]*)"|[0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(paramsRaw)) !== null) {
    params[m[1]] = m[3] !== undefined ? m[3] : m[2];
  }

  if (!params.keyid || !params.alg) return null;

  return {
    label,
    coveredComponents,
    keyId: params.keyid,
    algorithm: params.alg,
    created: params.created ? Number(params.created) : undefined,
    expires: params.expires ? Number(params.expires) : undefined,
    nonce: params.nonce,
  };
}

export function parseSignatureHeader(headerValue: string, label: string): Uint8Array | null {
  const regex = new RegExp(`${label}=:([A-Za-z0-9+/=]+):`);
  const match = headerValue.match(regex);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function buildSignatureBase(request: Request, parsed: ParsedSignatureInput): string {
  const url = new URL(request.url);
  const lines: string[] = [];

  for (const component of parsed.coveredComponents) {
    switch (component) {
      case "@method":
        lines.push(`"@method": ${request.method.toUpperCase()}`);
        break;
      case "@authority":
        lines.push(`"@authority": ${url.host}`);
        break;
      case "@path":
        lines.push(`"@path": ${url.pathname}`);
        break;
      case "@target-uri":
        lines.push(`"@target-uri": ${url.toString()}`);
        break;
      default: {
        const headerValue = request.headers.get(component);
        lines.push(`"${component}": ${headerValue ?? ""}`);
      }
    }
  }

  const paramsLine =
    `"@signature-params": (${parsed.coveredComponents.map((c) => `"${c}"`).join(" ")})` +
    `;keyid="${parsed.keyId}";alg="${parsed.algorithm}"` +
    (parsed.created ? `;created=${parsed.created}` : "") +
    (parsed.expires ? `;expires=${parsed.expires}` : "");

  lines.push(paramsLine);
  return lines.join("\n");
}

export async function verifyEd25519Signature(
  signatureBase: string,
  signature: Uint8Array,
  publicKeyRaw: Uint8Array
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", publicKeyRaw, { name: "Ed25519" }, false, ["verify"]);
    const data = new TextEncoder().encode(signatureBase);
    return await crypto.subtle.verify("Ed25519", key, signature, data);
  } catch {
    return false;
  }
}

export function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
