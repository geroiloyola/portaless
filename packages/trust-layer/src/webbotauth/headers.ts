// Lectura de headers Web Bot Auth, compartida por los dos verificadores:
//   - webbotauth/verify.ts: control de acceso del middleware. Solo usa
//     WebCrypto: corre igual en Cloudflare Pages, self-host Node y cualquier
//     otra plataforma de paginas con Functions.
//   - site-trust/web-bot-auth.ts: fuente "agent" de SiteTrustScore.
// Un solo lugar para las reglas evita que los dos verificadores diverjan.
//
// Reglas: draft-meunier-web-bot-auth-architecture (draft-03) + RFC 9421.
// Cloudflare aplica las mismas (docs Web Bot Auth, 2026-07-01). Se usa como
// implementacion de referencia para contrastar, no como la unica plataforma.
//
// - Signature-Agent es un sf-string: "https://agent.example" CON comillas.
//   Se rechazan la forma sin comillas, la de diccionario (sig1="..."), los
//   valores sin https:// y las URLs con credenciales.
// - Signature-Input: una sola firma, tag="web-bot-auth", keyid, y
//   "signature-agent" entre los componentes firmados. Si no esta firmado, un
//   intermediario puede cambiarlo y hacer que se busque la clave en otro
//   directorio.
// - Se rechazan componentes con parametros (;sf ;key ;bs ;req ;tr) y
//   @query-params / @status: ninguno de los verificadores los serializa.

export function parseSignatureAgent(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return null;
  const inner = value.slice(1, -1);
  if (!inner || inner.includes('"') || inner.includes("\\")) return null;
  if (!/^https:\/\//i.test(inner)) return null;
  try {
    const url = new URL(inner);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export type SignatureInputFailure =
  | "missing_signature_input"
  | "multiple_signatures_unsupported"
  | "missing_web_bot_auth_tag"
  | "missing_keyid"
  | "unsupported_component"
  | "unsupported_component_parameter"
  | "signature_agent_not_signed";

export interface WebBotAuthSignatureInput {
  ok: true;
  label: string;
  keyId: string;
  components: string[];
  alg?: string;
  created?: number;
  expires?: number;
  nonce?: string;
  /** Valor de la firma tal como llego, despues de "label=". Es la linea @signature-params (RFC 9421, 2.3). */
  signatureParams: string;
}

export type SignatureInputParse = WebBotAuthSignatureInput | { ok: false; reason: SignatureInputFailure };

const TOKEN = "[a-z*][a-z0-9_.*-]*";
const PARAM = `;${TOKEN}(?:=(?:"[^"]*"|[^;,\\s()"]*))?`;
const MEMBER_RE = new RegExp(`(${TOKEN})=(\\(((?:[^()"]|"[^"]*")*)\\)((?:${PARAM})*))`, "gi");
const COMPONENT_RE = new RegExp(`"([^"]*)"((?:${PARAM})*)`, "gi");
const PARAM_RE = new RegExp(`;(${TOKEN})(?:=(?:"([^"]*)"|([^;,\\s()"]*)))?`, "gi");
const UNSUPPORTED_COMPONENTS = new Set(["@query-params", "@status"]);

export function parseWebBotAuthSignatureInput(raw: string | null | undefined): SignatureInputParse {
  if (!raw || !raw.trim()) return { ok: false, reason: "missing_signature_input" };
  const members = [...raw.matchAll(MEMBER_RE)];
  if (members.length === 0) return { ok: false, reason: "missing_signature_input" };
  if (members.length > 1) return { ok: false, reason: "multiple_signatures_unsupported" };

  const [, label, signatureParams, listRaw, paramsRaw] = members[0];
  const params = new Map<string, string>();
  for (const p of (paramsRaw ?? "").matchAll(PARAM_RE)) params.set(p[1].toLowerCase(), p[2] ?? p[3] ?? "");

  if (params.get("tag") !== "web-bot-auth") return { ok: false, reason: "missing_web_bot_auth_tag" };
  const keyId = params.get("keyid");
  if (!keyId) return { ok: false, reason: "missing_keyid" };

  const components: string[] = [];
  for (const c of (listRaw ?? "").matchAll(COMPONENT_RE)) {
    if (c[2]) return { ok: false, reason: "unsupported_component_parameter" };
    const name = c[1].toLowerCase();
    if (UNSUPPORTED_COMPONENTS.has(name)) return { ok: false, reason: "unsupported_component" };
    components.push(name);
  }
  if (!components.includes("signature-agent")) return { ok: false, reason: "signature_agent_not_signed" };

  const num = (key: string) => {
    const v = params.get(key);
    return v && /^\d+$/.test(v) ? Number(v) : undefined;
  };
  return {
    ok: true,
    label,
    keyId,
    components,
    alg: params.get("alg") || undefined,
    created: num("created"),
    expires: num("expires"),
    nonce: params.get("nonce") || undefined,
    signatureParams: signatureParams.trim(),
  };
}
