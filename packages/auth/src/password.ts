// Hashing de contrasenas usando scrypt asincrono del modulo nativo "node:crypto" --
// deliberadamente NO se usa una libreria externa como bcrypt/argon2 para
// evitar dependencias nativas que requieran compilacion (node-gyp), algo
// que complica despliegues self-hosted simples. scrypt es parte del
// estandar de Node desde la v10 y es resistente a ataques por hardware
// especializado (ASIC/GPU) gracias a su alto costo de memoria.
//
// A-08: N=2^17 (OWASP 2024+). El formato incluye N para poder verificar
// hashes viejos y rehashear al autenticar:
//   scrypt:<N>:<salt-hex>:<hash-hex>
// El formato historico de 3 partes (scrypt:<salt>:<hash>) se sigue
// aceptando como N=2^14 y se marca para rehash.

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
export const SCRYPT_COST_N = 1 << 17;
export const LEGACY_SCRYPT_COST_N = 1 << 14;
const MIN_SCRYPT_N = 1 << 10;
const MAX_SCRYPT_N = 1 << 20;
// 128 * N * r = 128 MiB para N=2^17, r=8; Node exige maxmem > ese valor.
const SCRYPT_MAXMEM = 160 * 1024 * 1024;

interface ParsedHash {
  n: number;
  salt: Buffer;
  expected: Buffer;
  legacy: boolean;
}

function parseHash(storedHash: string): ParsedHash | null {
  const parts = String(storedHash).split(":");
  if (parts[0] !== "scrypt") return null;
  let n: number;
  let saltHex: string;
  let hashHex: string;
  let legacy: boolean;
  if (parts.length === 4) {
    n = Number(parts[1]);
    saltHex = parts[2];
    hashHex = parts[3];
    legacy = false;
  } else if (parts.length === 3) {
    n = LEGACY_SCRYPT_COST_N;
    saltHex = parts[1];
    hashHex = parts[2];
    legacy = true;
  } else {
    return null;
  }
  if (!Number.isSafeInteger(n) || n < MIN_SCRYPT_N || n > MAX_SCRYPT_N) return null;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return null;
  return { n, salt: Buffer.from(saltHex, "hex"), expected: Buffer.from(hashHex, "hex"), legacy };
}

function deriveKey(plainPassword: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plainPassword, salt, SCRYPT_KEYLEN, { N: n, maxmem: SCRYPT_MAXMEM }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(plainPassword, salt, SCRYPT_COST_N);
  return `scrypt:${SCRYPT_COST_N}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
  const parsed = parseHash(storedHash);
  if (!parsed) return false;
  const derived = await deriveKey(plainPassword, parsed.salt, parsed.n);
  if (derived.length !== parsed.expected.length) return false;
  return timingSafeEqual(derived, parsed.expected);
}

/** true si el hash usa el formato/costo viejo y debe rehashearse al autenticar. */
export function passwordNeedsRehash(storedHash: string): boolean {
  const parsed = parseHash(storedHash);
  return !parsed || parsed.legacy || parsed.n < SCRYPT_COST_N;
}
