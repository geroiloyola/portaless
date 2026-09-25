// Cifrado AES-GCM de credenciales OAuth en reposo.
// Clave separada de PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY a proposito:
// comprometer una no debe exponer la otra.
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) {
    throw new Error("PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY ausente o menor a 32 caracteres");
  }
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(payload: string, secret: string): Promise<string> {
  const [v, iv, ct] = payload.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Formato de token cifrado invalido");
  const key = await importKey(secret);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return dec.decode(pt);
}

export function randomUrlSafe(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return b64(d).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
