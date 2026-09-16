// TOTP (RFC 6238) sin dependencias externas -- HMAC-SHA1 via node:crypto,
// igual que password.ts evita libs con binarios nativos para no complicar
// despliegues self-hosted. Compatible con Google Authenticator, Authy,
// 1Password, etc. (todos implementan RFC 6238 con SHA1/30s/6 digitos, el
// perfil de facto de la industria).

import { createHmac, randomBytes } from "node:crypto";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // acepta +/-1 paso (30s) de desvio de reloj del usuario.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  // 20 bytes = 160 bits, recomendado por RFC 4226 seccion 4, codificado en base32.
  return base32Encode(randomBytes(20));
}

export function buildTotpUri(secret: string, username: string, issuer = "Portaless"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function verifyTotpCode(secret: string, code: string, now: number = Date.now()): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;

  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    if (computeTotpCode(secret, counter + drift) === trimmed) return true;
  }
  return false;
}

function computeTotpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter % 0x100000000, 4);

  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
